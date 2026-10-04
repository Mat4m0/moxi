import type { DocumentChange, DocumentRef, RequestOf, ResponseOf } from "@moxi/contracts";

export interface DocumentPort {
  read(ref: DocumentRef): Promise<ResponseOf<"plugin.doc.read">>;
  write(request: RequestOf<"plugin.doc.write">): Promise<ResponseOf<"plugin.doc.write">>;
  onChange(listener: (change: DocumentChange) => void): () => void;
}
