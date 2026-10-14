// Two builds of moxi's fixture client ("generation A" and "generation B") in one client cache.
// Only the fixture's own files are used; no ArenaNet bytes exist anywhere in this probe.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  confirmHealthy,
  parseGenerations,
  parseManifest,
  stageCandidate,
} from "../../../apps/desktop/src/game-files/index.ts";

export type Label = "A" | "B";
export const chunkSize = 65536;
export const snapshotSize = 150_000;
// Ranges used for lazy snapshot reads. The second one crosses the first chunk boundary.
export const snapshotRanges = ["0-15", "65530-65545", "131000-131999"] as const;

export interface Generation {
  readonly label: Label;
  readonly token: string;
  readonly files: ReadonlyMap<string, Buffer>;
  /** sha256 of what a client must receive: whole files, and each snapshot range. */
  readonly expected: Readonly<Record<string, string>>;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function uleb(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest) byte |= 0x80;
    out.push(byte);
  } while (rest);
  return out;
}

// A custom section is ignored by every engine, so the module still runs as the fixture does.
function stampWasm(wasm: Buffer, label: Label): Buffer {
  const name = Buffer.from("pb14");
  const payload = Buffer.from(`${label}${label.toLowerCase().repeat(15)}`);
  const body = Buffer.concat([Buffer.from(uleb(name.length)), name, payload]);
  return Buffer.concat([wasm, Buffer.from([0x00, ...uleb(body.length)]), body]);
}

function stampGlue(glue: string, label: Label): string {
  const hook = "module.instantiateWasm({}, (instance) => {";
  if (!glue.includes(hook)) throw new Error("The fixture glue changed; update the PB14 stamp.");
  // The success callback receives the module as its second argument.
  const read =
    'globalThis.__PB14_WASM = new TextDecoder().decode(WebAssembly.Module.customSections(wasmModule, "pb14")[0] ?? new ArrayBuffer(0)).slice(0, 1);';
  return `globalThis.__PB14_GLUE = "${label}";\n${glue.replace(
    hook,
    `module.instantiateWasm({}, (instance, wasmModule) => { ${read}`,
  )}\n// PB14 generation ${label}\n`;
}

function snapshot(label: Label): Buffer {
  const seed = label === "A" ? 13 : 29;
  const bytes = Buffer.alloc(snapshotSize);
  for (let index = 0; index < snapshotSize; index++)
    bytes[index] = (index * 7 + seed + (index >> 8) * 3) & 0xff;
  bytes.write(`PB14-${label}`, 0, "ascii");
  return bytes;
}

export async function buildGeneration(fixtureDir: string, label: Label): Promise<Generation> {
  const glue = await readFile(join(fixtureDir, "glue.js"), "utf8");
  const wasm = await readFile(join(fixtureDir, "client.wasm"));
  const files = new Map<string, Buffer>([
    ["Gw.jspi.js", Buffer.from(stampGlue(glue, label))],
    ["Gw.jspi.wasm", stampWasm(wasm, label)],
    ["Gw.snapshot", snapshot(label)],
    ["version.json", Buffer.from("{}")],
  ]);
  const expected: Record<string, string> = {
    "Gw.jspi.js": sha256(files.get("Gw.jspi.js")!),
    "Gw.jspi.wasm": sha256(files.get("Gw.jspi.wasm")!),
  };
  const bytes = files.get("Gw.snapshot")!;
  for (const range of snapshotRanges) {
    const [start, end] = range.split("-").map(Number) as [number, number];
    expected[`Gw.snapshot ${range}`] = sha256(bytes.subarray(start, end + 1));
  }
  return { label, token: randomUUID(), files, expected };
}

function chunkHashesOf(bytes: Buffer): string[] {
  const hashes: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    hashes.push(sha256(bytes.subarray(offset, offset + chunkSize)));
  return hashes;
}

// The snapshot is read through the content-addressed chunk store, which indexes its directory
// once. The background download of a candidate therefore lands its chunks before any window opens.
export async function preloadChunks(cacheDir: string, generation: Generation) {
  await mkdir(join(cacheDir, "chunks"), { recursive: true });
  for (const bytes of generation.files.values())
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      await writeFile(join(cacheDir, "chunks", sha256(chunk)), chunk);
    }
}

async function writeGeneration(cacheDir: string, generation: Generation) {
  const directory = join(cacheDir, "generations", generation.token);
  await mkdir(directory, { recursive: true });
  const manifestFiles = [];
  for (const [name, bytes] of generation.files) {
    await writeFile(join(directory, name), bytes);
    manifestFiles.push({ name, size: bytes.length, chunkHashes: chunkHashesOf(bytes) });
  }
  const manifest = Buffer.from(
    JSON.stringify({ compressionMode: "none", chunkSize, files: manifestFiles }),
  );
  parseManifest(manifest);
  await writeFile(join(directory, "manifest.json"), manifest);
}

async function publish(cacheDir: string, state: unknown) {
  const temp = join(cacheDir, `${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(state));
  await rename(temp, join(cacheDir, "generations.json"));
}

/** Generation A becomes the active, healthy generation (a normal installed client). */
export async function installActive(cacheDir: string, generation: Generation) {
  await mkdir(cacheDir, { recursive: true });
  await preloadChunks(cacheDir, generation);
  await writeGeneration(cacheDir, generation);
  const empty = { active: null, candidate: null, previous: null } as const;
  await publish(
    cacheDir,
    confirmHealthy(stageCandidate(empty, generation.token), generation.token),
  );
}

/** A background update stages generation B as the candidate while a window still runs A. */
export async function stageUpdate(cacheDir: string, generation: Generation) {
  await writeGeneration(cacheDir, generation);
  const current = parseGenerations(JSON.parse(await readFile(join(cacheDir, "generations.json"), "utf8")));
  await publish(cacheDir, stageCandidate(current, generation.token));
}
