import type { DocumentChange, RequestOf, ResponseOf } from "@moxi/contracts";
import { docs, type Database } from "./storage/index.ts";

export function createPluginDocuments(database: Database) {
  const documents = docs(database);
  return {
    read(ref: RequestOf<"plugin.doc.read">): ResponseOf<"plugin.doc.read"> {
      const stored = documents.read(ref);
      return stored ? { value: stored.json, revision: stored.revision } : null;
    },
    write({ ref, value, expectedRevision }: RequestOf<"plugin.doc.write">) {
      return documents.write(ref, value, expectedRevision);
    },
    onChange(listener: (change: DocumentChange) => void) {
      return documents.onChange(({ ref, revision }) => {
        listener({ ref, revision, value: documents.read(ref)!.json });
      });
    },
  };
}
