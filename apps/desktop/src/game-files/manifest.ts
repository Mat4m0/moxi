import { type } from "arktype";
import { contentHash, MAX_CHUNK_SIZE } from "./chunks";
import type { Compression } from "./chunks";
import { GameFileError } from "./errors";

const rawManifest = type({
  compressionMode: "unknown",
  chunkSize: "unknown",
  "directories?": "unknown",
  "files?": "unknown",
});
const rawDirectory = type({ name: "unknown", "parentIndex?": "unknown" });
const rawFile = type({
  name: "unknown",
  size: "unknown",
  chunkHashes: "unknown",
  "parentIndex?": "unknown",
});
const list = type("unknown[]");
const required = ["Gw.jspi.js", "Gw.jspi.wasm", "version.json", "Gw.snapshot"];

export interface ManifestFile {
  readonly name: string;
  readonly size: number;
  readonly chunkSize: number;
  readonly chunkHashes: readonly string[];
}

export interface Manifest {
  readonly compression: Compression;
  readonly chunkSize: number;
  readonly files: ReadonlyMap<string, ManifestFile>;
}

function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 255 ||
    /[/\\\0]/.test(value) ||
    [".", "..", "__proto__", "prototype", "constructor"].includes(value)
  ) {
    throw new GameFileError("manifest_name", "Invalid manifest name.");
  }
  return value;
}

export function parseManifest(bytes: Uint8Array): Manifest {
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw new GameFileError("manifest_bytes", "Manifest exceeds its size limit.");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new GameFileError("manifest_format", "Cannot read manifest.", { cause });
  }
  const raw = rawManifest(json);
  if (raw instanceof type.errors)
    throw new GameFileError("manifest_format", "Invalid manifest structure.");
  if (raw.compressionMode !== "none" && raw.compressionMode !== "gzip")
    throw new GameFileError("bad_compression", "Unsupported chunk compression.");
  const chunkSize = raw.chunkSize;
  if (
    typeof chunkSize !== "number" ||
    !Number.isSafeInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize > MAX_CHUNK_SIZE
  )
    throw new GameFileError("bad_chunk_size", "Invalid manifest chunk size.");
  const dirs = list(raw.directories ?? []);
  if (dirs instanceof type.errors || dirs.length > 4096)
    throw new GameFileError("manifest_directories", "Invalid directory list.");
  const entries = list(raw.files ?? []);
  if (entries instanceof type.errors || entries.length > 4096)
    throw new GameFileError("manifest_files", "Invalid file list.");
  function parent(value: unknown): number {
    // ArenaNet uses null or an omitted field for root; index zero also means root.
    if (value === null || value === undefined) return 0;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value >= dirs.length
    )
      throw new GameFileError("manifest_parent", "Invalid parent directory.");
    return value;
  }
  const directories = dirs.map((value) => {
    const dir = rawDirectory(value);
    if (dir instanceof type.errors)
      throw new GameFileError("manifest_directories", "Invalid directory entry.");
    return { name: name(dir.name), parent: parent(dir.parentIndex) };
  });
  const paths = new Map<number, string>();
  for (let index = 0; index < directories.length; index++) {
    const chain: number[] = [];
    const visiting = new Set<number>();
    let current = index;
    while (!paths.has(current)) {
      if (visiting.has(current))
        throw new GameFileError("manifest_cycle", "Directory parents form a cycle.");
      visiting.add(current);
      chain.push(current);
      const directory = directories[current]!;
      if (!directory.parent) break;
      current = directory.parent;
    }
    for (const part of chain.reverse()) {
      const directory = directories[part]!;
      paths.set(
        part,
        directory.parent ? `${paths.get(directory.parent)!}/${directory.name}` : directory.name,
      );
    }
  }
  const occupied = new Set(paths.values());
  if (occupied.size !== directories.length)
    throw new GameFileError("manifest_duplicate", "Duplicate directory path.");
  const files = new Map<string, ManifestFile>();
  const lengths = new Map<string, number>();
  let references = 0;
  for (const value of entries) {
    const file = rawFile(value);
    if (file instanceof type.errors)
      throw new GameFileError("manifest_files", "Invalid file entry.");
    const basename = name(file.name);
    const p = parent(file.parentIndex);
    const path = p ? `${paths.get(p)!}/${basename}` : basename;
    if (occupied.has(path))
      throw new GameFileError("manifest_duplicate", "Duplicate manifest path.");
    occupied.add(path);
    const size = file.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0)
      throw new GameFileError("manifest_size", "Invalid file size.");
    const hashes = list(file.chunkHashes);
    if (hashes instanceof type.errors || hashes.length !== Math.ceil(size / chunkSize))
      throw new GameFileError("chunk_count", "Chunk count does not match file size.");
    references += hashes.length;
    if (references > 1000000)
      throw new GameFileError("manifest_chunks", "Too many chunk references.");
    const chunkHashes = hashes.map(contentHash);
    for (const [index, hash] of chunkHashes.entries()) {
      const length = Math.min(chunkSize, size - index * chunkSize);
      const known = lengths.get(hash);
      if (known !== undefined && known !== length)
        throw new GameFileError("chunk_length", "One chunk hash has conflicting lengths.");
      lengths.set(hash, length);
    }
    files.set(path, { name: basename, size, chunkSize, chunkHashes });
  }
  for (const artifact of required) {
    if ([...files.values()].filter((file) => file.name === artifact).length !== 1)
      throw new GameFileError(
        "manifest_required",
        `Manifest must contain exactly one ${artifact}.`,
      );
  }
  return { compression: raw.compressionMode, chunkSize, files };
}
