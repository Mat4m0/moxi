import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { GameFileError } from "./errors.ts";

export const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
export type Compression = "none" | "gzip";

export function contentHash(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) {
    throw new GameFileError("hash_format", "Invalid chunk hash.");
  }
  return value.toLowerCase();
}

export function chunkLength(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_CHUNK_SIZE) {
    throw new GameFileError("chunk_length", "Invalid chunk length.");
  }
}

export function verify(hash: string, data: Uint8Array, length: number): void {
  if (data.byteLength !== length)
    throw new GameFileError("chunk_length", "Chunk length does not match.");
  const algorithm = hash.length === 32 ? "md5" : hash.length === 40 ? "sha1" : "sha256";
  if (createHash(algorithm).update(data).digest("hex") !== hash) {
    throw new GameFileError("hash_mismatch", "Chunk content does not match its hash.");
  }
}

export async function decode(
  data: Uint8Array,
  compression: Compression,
  length: number,
): Promise<Uint8Array> {
  const limit = compression === "none" ? length : length + Math.max(65536, Math.ceil(length / 16));
  if (data.byteLength > limit)
    throw new GameFileError("chunk_length", "Encoded chunk exceeds its size limit.");
  if (compression === "none") return data;
  return new Promise((resolve, reject) => {
    gunzip(data, { maxOutputLength: length }, (cause, bytes) => {
      if (cause) reject(new GameFileError("chunk_decode", "Cannot decode chunk.", { cause }));
      else resolve(bytes);
    });
  });
}
