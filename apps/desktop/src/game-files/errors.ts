export type GameFileErrorCode =
  | "manifest_bytes"
  | "manifest_format"
  | "bad_compression"
  | "bad_chunk_size"
  | "manifest_directories"
  | "manifest_files"
  | "manifest_name"
  | "manifest_parent"
  | "manifest_cycle"
  | "manifest_duplicate"
  | "manifest_size"
  | "chunk_count"
  | "manifest_chunks"
  | "chunk_length"
  | "hash_format"
  | "manifest_required"
  | "hash_mismatch"
  | "chunk_decode"
  | "bad_range";

export class GameFileError extends Error {
  readonly code: GameFileErrorCode;
  constructor(code: GameFileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = "GameFileError";
  }
}
