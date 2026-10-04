import type { Database } from "./database";

export type CredentialSaveResult =
  | { ok: true }
  | { ok: false; reason: "encryption-unavailable" | "basic-text" };

export function createCredentialStore({
  isEncryptionAvailable,
  encrypt,
  decrypt,
  backend,
  db,
}: {
  isEncryptionAvailable: () => boolean;
  encrypt: (secret: string) => Uint8Array;
  decrypt: (ciphertext: Buffer) => string;
  backend: string;
  db: Database;
}) {
  return {
    save(account: string, secret: string): CredentialSaveResult {
      if (backend === "basic_text") return { ok: false, reason: "basic-text" };
      if (!isEncryptionAvailable()) return { ok: false, reason: "encryption-unavailable" };
      db.prepare(
        "INSERT INTO credentials (account, ciphertext) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET ciphertext = excluded.ciphertext",
      ).run(account, encrypt(secret));
      return { ok: true };
    },
    load(account: string): string | null {
      const row = db.prepare("SELECT ciphertext FROM credentials WHERE account = ?").get(account);
      if (!row) return null;
      if (!(row.ciphertext instanceof Uint8Array))
        throw new Error("Invalid credential ciphertext.");
      return decrypt(Buffer.from(row.ciphertext));
    },
    clear(account: string) {
      db.prepare("DELETE FROM credentials WHERE account = ?").run(account);
    },
  };
}
