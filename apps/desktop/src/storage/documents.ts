import { type } from "arktype";
import type { Database } from "./database";

import { documentRef as reference, jsonValue, type DocumentRef, type Json } from "@moxi/contracts";
export type { DocumentRef, Json } from "@moxi/contracts";
const documentRow = type({ json: "string", revision: "number.integer > 0" });
export interface DocumentChange {
  ref: DocumentRef;
  revision: number;
}

export function docs(db: Database) {
  const listeners = new Set<(change: DocumentChange) => void>();
  const select = db.prepare(
    "SELECT json, revision FROM documents WHERE plugin = ? AND scope = ? AND account = ? AND name = ?",
  );
  function read(ref: DocumentRef): { json: Json; revision: number } | null {
    reference.assert(ref);
    const row = select.get(ref.plugin, ref.scope, ref.account ?? "", ref.name);
    if (!row) return null;
    const valid = documentRow.assert(row);
    const parsed: unknown = JSON.parse(valid.json);
    const json = jsonValue.assert(parsed);
    return { json, revision: valid.revision };
  }
  return {
    read,
    write(
      ref: DocumentRef,
      json: Json,
      expectedRevision: number,
    ): { ok: true; revision: number } | { ok: false; revision: number } {
      reference.assert(ref);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new Error("Invalid expected revision.");
      const encoded = JSON.stringify(jsonValue.assert(json));
      if (encoded === undefined) throw new Error("Document must be JSON serializable.");
      db.exec("BEGIN IMMEDIATE");
      let revision: number;
      try {
        const current = read(ref)?.revision ?? 0;
        if (current !== expectedRevision) {
          db.exec("ROLLBACK");
          return { ok: false, revision: current };
        }
        revision = current + 1;
        db.prepare(`INSERT INTO documents (plugin, scope, account, name, json, revision) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(plugin, scope, account, name) DO UPDATE SET json = excluded.json, revision = excluded.revision`).run(
          ref.plugin,
          ref.scope,
          ref.account ?? "",
          ref.name,
          encoded,
          revision,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      for (const listener of listeners) listener({ ref: structuredClone(ref), revision });
      return { ok: true, revision };
    },
    onChange(listener: (change: DocumentChange) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
