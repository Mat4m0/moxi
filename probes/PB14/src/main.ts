// PB14 mini Main: two game windows at once, each in its own partition with its own handler for
// the privileged `moxi` scheme, closed over its own client routes. The "shared" arm is the control:
// the product's current shape (default session, one global `client`, replaced per game window).
// It uses moxi's real client routes, game renderer, game preload and fixture client. No product
// file is changed and no ArenaNet byte exists here.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, net, protocol, session } from "electron";
import type { Session } from "electron";
import { createClientCache } from "../../../apps/desktop/src/game-files/index.ts";
import { resolveRendererPath } from "../../../apps/desktop/src/protocol-path.ts";
import { createClientRoutes } from "../../../apps/desktop/src/shell/client.ts";
import {
  buildGeneration,
  installActive,
  preloadChunks,
  snapshotRanges,
  stageUpdate,
} from "./gen.ts";
import type { Generation, Label } from "./gen.ts";

type Routes = ReturnType<typeof createClientRoutes>;
type Account = "a" | "b";
type Json = Record<string, unknown>;

const arm: "partitioned" | "shared" = process.env.PB14_ARM === "shared" ? "shared" : "partitioned";
const firstAccount: Account = process.env.PB14_FIRST === "b" ? "b" : "a";
const secondAccount: Account = firstAccount === "a" ? "b" : "a";
const show = process.env.PB14_SHOW !== "0";
const fast = process.env.PB14_FAST === "1";
const launch = process.env.PB14_LAUNCH ?? "0";
const out = process.env.PB14_OUT ?? join(tmpdir(), "pb14.jsonl");
const warmMs = Number(process.env.PB14_WARM_S ?? (fast ? 2 : 10)) * 1000;
const samples = {
  S0: Number(process.env.PB14_S0 ?? (fast ? 3 : 30)),
  S1: Number(process.env.PB14_S1 ?? (fast ? 5 : 60)),
  S2: Number(process.env.PB14_S2 ?? (fast ? 5 : 60)),
};
const readyMs = (show ? 60 : 20) * 1000;

const appDir = app.getAppPath();
const repoRoot = resolve(appDir, "../..");
const work = process.env.PB14_WORK ?? mkdtempSync(join(tmpdir(), "pb14-"));
mkdirSync(work, { recursive: true });
app.setPath("userData", join(work, "userData"));
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "moxi",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const run = promisify(execFile);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const csp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'";

function emit(kind: string, data: Json = {}) {
  const line = JSON.stringify({ probe: "PB14", kind, arm, launch, t: Date.now(), ...data });
  appendFileSync(out, line + "\n");
  if (kind !== "sample") console.log(line.length > 1500 ? line.slice(0, 1500) + "..." : line);
}
async function guard<T>(name: string, work: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { step: name, message });
    return { error: message };
  }
}
process.on("uncaughtException", (error) => emit("error", { step: "uncaught", message: String(error) }));
process.on("unhandledRejection", (error) => emit("error", { step: "unhandled", message: String(error) }));

// ---------------------------------------------------------------- generations and handlers

interface Game {
  account: Account;
  win: BrowserWindow;
  ses: Session;
  routes: Routes;
  frames: number;
  framesAt: number;
  client?: { routes: Routes; token: string };
}
const games = new Map<number, Game>();
const permissionCalls: { account: string; kind: string; permission: string; allowed: boolean }[] = [];
const ledger: Json[] = [];
const labelOfToken = new Map<string, Label>();
const noNetwork: typeof fetch = () => Promise.reject(new Error("offline"));
let cacheDir = "";
let cache: ReturnType<typeof createClientCache>;
let sharedClient: Routes | undefined;
let roots: Record<"launcher" | "game" | "plugin-host", string>;

function reply(label: string, body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain",
      "Content-Security-Policy": csp,
      "X-Probe-Partition": label,
    },
  });
}

// Every response a client file handler gives is hashed on the way out, whichever window asked.
function record(label: string, request: Request, copy: Response, routes: Routes) {
  void (async () => {
    const bytes = Buffer.from(await copy.arrayBuffer());
    const info = await routes.info().catch(() => undefined);
    ledger.push({
      t: Date.now(),
      handler: label,
      from: request.headers.get("x-pb14-from") ?? "renderer",
      path: new URL(request.url).pathname,
      range: request.headers.get("range"),
      status: copy.status,
      generation: info ? labelOfToken.get(info.generationToken) : undefined,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  })().catch((error: unknown) => emit("error", { step: "ledger", message: String(error) }));
}

// The handler the design describes: one per partition, closed over that account's routes. In the
// shared arm there is one handler on the default session and `routesOf` reads the global `client`.
function gameHandler(label: string, routesOf: () => Routes) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const routes = routesOf();
    const hit = await routes.handle(request);
    if (hit) {
      hit.headers.set("Content-Security-Policy", csp);
      hit.headers.set("X-Probe-Partition", label);
      record(label, request, hit.clone(), routes);
      return hit;
    }
    if (request.method === "GET" && url.host === "app") {
      if (url.pathname === "/probe/who") return reply(label, label);
      if (arm === "partitioned" && url.pathname === `/probe/${label}`)
        return reply(label, `route of account ${label}`);
      if (url.pathname.startsWith("/game/")) {
        const file = resolveRendererPath(request.url, roots);
        if (file) {
          try {
            const response = await net.fetch(pathToFileURL(file).href);
            const headers = new Headers(response.headers);
            headers.set("Content-Security-Policy", csp);
            headers.set("X-Probe-Partition", label);
            return new Response(response.body, { status: response.status, headers });
          } catch {
            return reply(label, "Not found", 404);
          }
        }
      }
    }
    return reply(label, "Not found", 404);
  };
}

function setPermissions(ses: Session, label: string, allowed: readonly string[]) {
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    const ok = allowed.includes(permission);
    permissionCalls.push({ account: label, kind: "request", permission, allowed: ok });
    callback(ok);
  });
  ses.setPermissionCheckHandler((_contents, permission) => {
    const ok = allowed.includes(permission);
    permissionCalls.push({ account: label, kind: "check", permission, allowed: ok });
    return ok;
  });
}
// Deliberately different per account, to show the policies are per partition.
const policy: Record<Account, readonly string[]> = {
  a: ["pointerLock", "fullscreen"],
  b: ["pointerLock", "fullscreen", "notifications"],
};

// ---------------------------------------------------------------- game windows

ipcMain.handle("game.client", async (event) => {
  const game = games.get(event.sender.id);
  if (!game) throw new Error("Unknown game window.");
  const routes = arm === "shared" ? sharedClient! : game.routes;
  const info = await routes.info();
  game.client = { routes, token: info.generationToken };
  emit("ipc", { name: "game.client", account: game.account, generation: labelOfToken.get(info.generationToken) });
  return info;
});
ipcMain.handle("game.net.healthy", async (event, request: { token: string; frame: boolean }) => {
  const game = games.get(event.sender.id);
  if (!game?.client || game.client.token !== request.token)
    throw new Error("Game session is not connected.");
  // No game server in the fixture, so this stays false: a candidate is never promoted here.
  return game.client.routes.confirmHealthy(request.token, false, request.frame);
});
ipcMain.handle("game.client.failed", (event, token: string) => {
  const game = games.get(event.sender.id);
  emit("ipc", { name: "game.client.failed", account: game?.account });
  game?.client?.routes.reportFailure();
  void token;
});

async function createGame(account: Account): Promise<Game> {
  // Like the product, routes are created per game window.
  const routes = createClientRoutes(cacheDir, noNetwork, cache);
  let ses: Session;
  if (arm === "partitioned") {
    ses = session.fromPartition(`persist:account-${account}`);
    if (ses.protocol.isProtocolHandled("moxi")) ses.protocol.unhandle("moxi");
    ses.protocol.handle("moxi", gameHandler(account, () => routes));
    setPermissions(ses, account, policy[account]);
  } else {
    ses = session.defaultSession;
    sharedClient = routes;
  }
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    webPreferences: {
      ...(arm === "partitioned" ? { partition: `persist:account-${account}` } : {}),
      preload: join(repoRoot, "apps/desktop/dist/game.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // As the product: the client advances its loop on animation frames.
      backgroundThrottling: false,
      webSecurity: true,
    },
  });
  const game: Game = { account, win, ses, routes, frames: 0, framesAt: 0 };
  games.set(win.webContents.id, game);
  win.webContents.on("console-message", (...args: unknown[]) => {
    const first = args[0] as { message?: unknown } | undefined;
    const message = typeof first?.message === "string" ? first.message : String(args[2] ?? "");
    const frames = /\[gwkit\] frames=(\d+)/.exec(message);
    if (frames) {
      game.frames = Number(frames[1]);
      game.framesAt = Date.now();
    }
  });
  win.webContents.on("render-process-gone", (_event, details) =>
    emit("renderer-gone", { account, reason: details.reason }),
  );
  await win.loadURL("moxi://app/game/").catch((error: unknown) =>
    emit("error", { step: "loadURL", account, message: String(error) }),
  );
  if (show) win.showInactive();
  return game;
}

async function waitReady(game: Game): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < readyMs) {
    if (game.frames >= 3) {
      const hidden = await game.win.webContents
        .executeJavaScript('document.querySelector("[role=status]")?.hidden === true')
        .catch(() => false);
      if (hidden) return true;
    }
    await sleep(200);
  }
  return false;
}

const probeSource = () => readFileSync(join(appDir, "page/probe.js"), "utf8");
async function inject(game: Game) {
  await game.win.webContents.executeJavaScript(probeSource());
}
// Calls a function of the injected page probe and returns its structured result.
function page<T = Json>(game: Game, call: string): Promise<T> {
  return game.win.webContents.executeJavaScript(`__pb14.${call}`) as Promise<T>;
}

// ---------------------------------------------------------------- memory (Linux)

interface Smaps {
  rss: number;
  pss: number;
  priv: number;
}
async function readSmaps(pid: number): Promise<Smaps | undefined> {
  try {
    // Chromium renderers are not dumpable, so only root can read their smaps_rollup.
    const { stdout } = await run("sudo", ["-n", "cat", `/proc/${pid}/smaps_rollup`]);
    const field = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(stdout)?.[1] ?? NaN);
    return {
      rss: field("Rss"),
      pss: field("Pss"),
      priv: field("Private_Clean") + field("Private_Dirty"),
    };
  } catch {
    return undefined;
  }
}

async function memorySample(state: string, index: number) {
  if (process.platform !== "linux") return emit("sample", { state, index, unsupported: process.platform });
  const metrics = app.getAppMetrics();
  const rendererOf = new Map<number, string>();
  for (const game of games.values()) {
    const pid = game.win.isDestroyed() ? 0 : game.win.webContents.getOSProcessId();
    if (pid) rendererOf.set(pid, game.account);
  }
  const rows = await Promise.all(
    metrics.map(async (metric) => ({ metric, smaps: await readSmaps(metric.pid) })),
  );
  const byType: Record<string, number> = {};
  const byAccount: Record<string, number> = {};
  let priv = 0;
  let pss = 0;
  let rss = 0;
  let missing = 0;
  for (const { metric, smaps } of rows) {
    if (!smaps || Number.isNaN(smaps.priv)) {
      missing++;
      continue;
    }
    priv += smaps.priv;
    pss += smaps.pss;
    rss += smaps.rss;
    byType[metric.type] = (byType[metric.type] ?? 0) + smaps.priv;
    const account = rendererOf.get(metric.pid);
    if (account) byAccount[account] = (byAccount[account] ?? 0) + smaps.priv;
  }
  const frames: Record<string, number> = {};
  for (const game of games.values()) frames[game.account] = game.frames;
  emit("sample", {
    state,
    index,
    privKiB: priv,
    pssKiB: pss,
    rssKiB: rss,
    byType,
    byAccount,
    frames,
    processes: metrics.length,
    missing,
  });
}

async function sampleState(state: "S0" | "S1" | "S2") {
  emit("phase", { state, warmMs, samples: samples[state], games: games.size });
  await sleep(warmMs);
  const started = Date.now();
  for (let index = 0; index < samples[state]; index++) {
    await memorySample(state, index);
    const wait = started + (index + 1) * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  }
}

// ---------------------------------------------------------------- checks

interface Check {
  id: string;
  pass: boolean;
  detail: unknown;
}
const checks: Check[] = [];
function check(id: string, pass: boolean, detail: unknown) {
  checks.push({ id, pass, detail });
  emit("check", { id, pass, detail });
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function shaOf(entry: unknown): string | undefined {
  return (entry as { sha256?: string } | undefined)?.sha256;
}
function flat(result: Json): Record<string, string | undefined> {
  const keys = ["glue", "wasm", ...snapshotRanges.map((range) => `snapshot ${range}`)];
  const mapKey: Record<string, string> = { glue: "Gw.jspi.js", wasm: "Gw.jspi.wasm" };
  const out: Record<string, string | undefined> = {};
  for (const key of keys) out[mapKey[key] ?? key.replace("snapshot ", "Gw.snapshot ")] = shaOf(result[key]);
  return out;
}

async function functional(genOf: Record<Account, Generation>, ordered: Game[]) {
  const [first, second] = ordered as [Game, Game];
  const labelOf = (game: Game) => genOf[game.account].label;

  for (const game of ordered) await guard("inject", () => inject(game));

  // 1. Which client each window is running (stamps the executed glue and instantiated module).
  const identity = {} as Record<Account, Json>;
  for (const game of ordered) identity[game.account] = await guard("identity", () => page(game, "identity()"));
  emit("identity", { identity });
  check(
    "boot-identity",
    ordered.every((game) => {
      const id = identity[game.account];
      return id.glue === labelOf(game) && id.wasm === labelOf(game);
    }),
    { expected: Object.fromEntries(ordered.map((game) => [game.account, labelOf(game)])), identity },
  );

  // 2. Bytes each window receives now, after the update was staged and the second window opened.
  const hashes = {} as Record<Account, Json>;
  for (const game of ordered)
    hashes[game.account] = await guard("hashes", () => page(game, `hashes(${JSON.stringify(snapshotRanges)})`));
  const refetch: Record<string, unknown> = {};
  for (const game of ordered) {
    const got = flat(hashes[game.account]);
    const want = genOf[game.account].expected;
    refetch[game.account] = {
      matchesOwnGeneration: same(got, want),
      matchesOther: same(got, genOf[game.account === "a" ? "b" : "a"].expected),
      mismatched: Object.keys(want).filter((key) => got[key] !== want[key]),
      stamp: hashes[game.account].compiledStamp,
    };
  }
  check(
    "refetch-own-generation",
    ordered.every((game) => (refetch[game.account] as { matchesOwnGeneration: boolean }).matchesOwnGeneration),
    refetch,
  );

  // 3. Bytes straight from each partition's handler, asked by Main (no renderer involved).
  const direct: Record<string, unknown> = {};
  for (const game of ordered) {
    direct[game.account] = await guard("main-fetch", async () => {
      const result: Record<string, string> = {};
      const headers = { "x-pb14-from": "main" };
      for (const name of ["Gw.jspi.js", "Gw.jspi.wasm"]) {
        const response = await game.ses.fetch(`moxi://app/client/${name}`, { headers });
        result[name] = sha256(Buffer.from(await response.arrayBuffer()));
      }
      for (const range of snapshotRanges) {
        const response = await game.ses.fetch("moxi://app/client/Gw.snapshot", {
          headers: { ...headers, Range: `bytes=${range}` },
        });
        result[`Gw.snapshot ${range}`] = sha256(Buffer.from(await response.arrayBuffer()));
      }
      return result;
    });
  }
  check(
    "main-fetch-own-generation",
    ordered.every((game) => same(direct[game.account], genOf[game.account].expected)),
    { direct, sameSession: first.ses === second.ses },
  );

  // 4. Routes each handler serves and refuses.
  const routes = {} as Record<Account, Json>;
  for (const game of ordered)
    routes[game.account] = await guard("routes", () => page(game, `routes(${JSON.stringify(game.account)})`));
  const status = (game: Game, path: string) => (routes[game.account][path] as { status?: number } | undefined)?.status;
  const partitionOf = (game: Game, path: string) =>
    (routes[game.account][path] as { partition?: string } | undefined)?.partition;
  if (arm === "partitioned") {
    check(
      "handler-per-partition",
      ordered.every((game) => partitionOf(game, "/probe/who") === game.account),
      { who: Object.fromEntries(ordered.map((game) => [game.account, partitionOf(game, "/probe/who")])) },
    );
    check(
      "other-routes-refused",
      ordered.every((game) => {
        const other = game.account === "a" ? "b" : "a";
        return (
          status(game, `/probe/${game.account}`) === 200 &&
          status(game, `/probe/${other}`) === 404 &&
          status(game, "/launcher/") === 404 &&
          status(game, "/plugin-host/") === 404 &&
          status(game, "/client/nope") === 404 &&
          status(game, "/game/") === 200
        );
      }),
      routes,
    );
  } else {
    emit("info", { id: "shared-arm-routes", note: "one handler on the default session", routes });
  }

  // 5. Storage: one marker per window, then what every window can read.
  const nonces = { a: randomBytes(4).toString("hex"), b: randomBytes(4).toString("hex") };
  const wrote = {} as Record<Account, Json>;
  for (const game of ordered)
    wrote[game.account] = await guard("storageWrite", () =>
      page(game, `storageWrite(${JSON.stringify(game.account)}, ${JSON.stringify(nonces[game.account])})`),
    );
  const read = {} as Record<Account, Json>;
  for (const game of ordered) read[game.account] = await guard("storageRead", () => page(game, "storageRead()"));
  const markers = (game: Game) => ({
    idb: (read[game.account].idb as { marker?: string } | undefined)?.marker,
    localStorage: read[game.account].localStorage,
    cache: (read[game.account].cache as { marker?: string } | undefined)?.marker,
    cookie: read[game.account].cookie,
  });
  const ownOnly = (game: Game) => {
    const seen = markers(game);
    const own = `${game.account}:${nonces[game.account]}`;
    return seen.idb === own && seen.localStorage === own && seen.cache === own && seen.cookie === `pb14=${game.account}`;
  };
  check("storage-separate", ordered.every(ownOnly), {
    nonces,
    seen: Object.fromEntries(ordered.map((game) => [game.account, markers(game)])),
    databases: Object.fromEntries(ordered.map((game) => [game.account, read[game.account].databases])),
    wrote,
  });
  emit("storage-detail", { read });

  // 6. JSPI in both windows at once: started together, each runs several suspended stacks.
  const delay = 1500;
  const jspi = await Promise.all(
    ordered.map((game) => guard("jspi", () => page<Json>(game, `jspi(${delay}, 4)`))),
  );
  const spans = jspi as { start?: number; end?: number; results?: number[]; ms?: number }[];
  const overlap =
    spans.every((span) => span.start !== undefined && span.end !== undefined) &&
    Math.max(...spans.map((span) => span.start!)) < Math.min(...spans.map((span) => span.end!));
  const framesBefore = ordered.map((game) => game.frames);
  await sleep(3000);
  const framesAfter = ordered.map((game) => game.frames);
  check(
    "jspi-both-windows",
    overlap &&
      spans.every((span) => same(span.results, [42, 42, 42, 42])) &&
      framesAfter.every((value, index) => value > framesBefore[index]!),
    { jspi, overlap, framesBefore, framesAfter },
  );

  // 7. Permission handlers and CSP, per partition.
  const policies = {} as Record<Account, Json>;
  for (const game of ordered) policies[game.account] = await guard("policy", () => page(game, "policy()"));
  const notified = (game: Game) => policies[game.account].notificationsRequest;
  if (arm === "partitioned") {
    check(
      "permissions-per-partition",
      ordered.every((game) => notified(game) === (game.account === "b" ? "granted" : "denied")),
      { policies, calls: permissionCalls },
    );
  } else {
    emit("info", { id: "shared-arm-permissions", note: "one session, one policy", policies, calls: permissionCalls });
  }
  check(
    "csp-per-partition",
    ordered.every(
      (game) => policies[game.account].documentCsp === csp && policies[game.account].evalBlocked === true,
    ),
    policies,
  );

  // 8. Separate renderer processes and storage directories.
  const pids = ordered.map((game) => game.win.webContents.getOSProcessId());
  const paths = ordered.map((game) => game.ses.getStoragePath() ?? null);
  check(
    "separate-process-and-storage-path",
    new Set(pids).size === 2 && (arm === "partitioned" ? new Set(paths).size === 2 : true),
    { pids, paths, sameSession: first.ses === second.ses },
  );

  await sleep(500);
  emit("ledger", { entries: ledger });
}

// Close the first account's window and open it again: its partition keeps its storage.
async function reopen(genOf: Record<Account, Generation>, firstGame: Game, secondGame: Game) {
  const account = firstGame.account;
  games.delete(firstGame.win.webContents.id);
  firstGame.win.destroy();
  await sleep(1000);
  const again = await createGame(account);
  const ready = await waitReady(again);
  await inject(again);
  const identity = await guard("identity", () => page(again, "identity()"));
  const read = (await guard("storageRead", () => page<Json>(again, "storageRead()"))) as Json;
  const info = await again.routes.info().catch(() => undefined);
  const marker = (read.idb as { marker?: string } | undefined)?.marker;
  const generation = info ? labelOfToken.get(info.generationToken) : undefined;
  emit("reopen", {
    account,
    ready,
    identity,
    marker,
    generation,
    expectedGeneration: "candidate-or-active",
    otherAccountStillRuns: !secondGame.win.isDestroyed(),
    read,
  });
  check("reopen-keeps-own-storage", marker?.startsWith(`${account}:`) === true, { marker, generation, ready });
  void genOf;
}

// ---------------------------------------------------------------- scenario

async function scenario() {
  emit("env", {
    arm,
    firstAccount,
    show,
    fast,
    os: `${process.platform} ${release()}`,
    runner: process.env.PB14_RUNNER ?? "unknown",
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
    totalMemMiB: Math.round(totalmem() / 1048576),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    samples,
    warmMs,
  });
  await app.whenReady();
  app.on("window-all-closed", () => {});
  cacheDir = join(work, "game");
  roots = {
    launcher: join(work, "none"),
    game: join(repoRoot, "apps/game/dist"),
    "plugin-host": join(work, "none"),
  };
  const fixtureDir = join(repoRoot, "tools/fixture-client");
  const generations = { A: await buildGeneration(fixtureDir, "A"), B: await buildGeneration(fixtureDir, "B") };
  for (const generation of Object.values(generations)) labelOfToken.set(generation.token, generation.label);
  await installActive(cacheDir, generations.A);
  await preloadChunks(cacheDir, generations.B);
  cache = createClientCache(cacheDir, noNetwork);
  const genOf: Record<Account, Generation> = {
    [firstAccount]: generations.A,
    [secondAccount]: generations.B,
  } as Record<Account, Generation>;
  emit("generations", {
    A: { token: generations.A.token, expected: generations.A.expected },
    B: { token: generations.B.token, expected: generations.B.expected },
    first: firstAccount,
  });

  // Default-session handler: the launcher's stand-in in the partitioned arm; the shared game
  // handler (global `client`, like the product today) in the shared arm.
  if (arm === "partitioned") {
    session.defaultSession.protocol.handle("moxi", async (request) =>
      new URL(request.url).pathname === "/launcher/"
        ? reply("default", "launcher stand-in")
        : reply("default", "Not found", 404),
    );
    setPermissions(session.defaultSession, "default", []);
  } else {
    session.defaultSession.protocol.handle("moxi", gameHandler("shared", () => sharedClient!));
    setPermissions(session.defaultSession, "shared", ["pointerLock", "fullscreen"]);
  }

  await sampleState("S0");

  const firstGame = await createGame(firstAccount);
  const firstReady = await waitReady(firstGame);
  emit("window", { account: firstAccount, ready: firstReady, frames: firstGame.frames });
  await sampleState("S1");

  // A background update stages generation B while the first window runs A.
  await stageUpdate(cacheDir, generations.B);
  emit("staged", { candidate: generations.B.token, state: await cache.state() });
  const secondGame = await createGame(secondAccount);
  const secondReady = await waitReady(secondGame);
  emit("window", { account: secondAccount, ready: secondReady, frames: secondGame.frames });
  await sampleState("S2");

  const ordered = [firstGame, secondGame];
  await guard("functional", () => functional(genOf, ordered));
  if (arm === "partitioned") await guard("reopen", () => reopen(genOf, firstGame, secondGame));

  emit("summary", {
    pass: checks.filter((entry) => entry.pass).map((entry) => entry.id),
    fail: checks.filter((entry) => !entry.pass).map((entry) => entry.id),
    windowsReady: { [firstAccount]: firstReady, [secondAccount]: secondReady },
  });
}

const watchdog = setTimeout(() => {
  emit("fatal", { message: "PB14 watchdog expired" });
  app.exit(2);
}, Number(process.env.PB14_TIMEOUT_S ?? 900) * 1000);
scenario()
  .catch((error: unknown) => emit("fatal", { message: String(error) }))
  .finally(() => {
    clearTimeout(watchdog);
    app.exit(0);
  });
