import { expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channels, validateRequest, type DocumentChange } from "@moxi/contracts";
import { openDatabase, migrations } from "./storage/index.ts";
import { createPluginDocuments } from "./plugin-documents.ts";

test("documents sent through validated channels survive restart, refuse stale writes and reach a second session", () => {
  const directory = mkdtempSync(join(tmpdir(), "moxi-plugin-docs-"));
  const options = {
    file: join(directory, "moxi.sqlite"),
    backupDir: join(directory, "backups"),
    appVersion: "0.1.0",
    migrations,
  };
  let database = openDatabase(options);
  try {
    const documents = createPluginDocuments(database);
    const first: DocumentChange[] = [];
    const second: DocumentChange[] = [];
    documents.onChange((change) => first.push(change));
    documents.onChange((change) => second.push(change));
    const ref = { plugin: "notes", scope: "global", account: null, name: "build" } as const;
    const write = (value: string, expectedRevision: number) =>
      documents.write(
        channels["plugin.doc.write"].request.assert(
          validateRequest("plugin.doc.write", "pluginHost", { ref, value, expectedRevision }),
        ),
      );
    expect(write("saved", 0)).toEqual({ ok: true, revision: 1 });
    expect(write("stale", 0)).toEqual({ ok: false, revision: 1 });
    expect(first).toEqual([{ ref, value: "saved", revision: 1 }]);
    expect(second).toEqual([{ ref, value: "saved", revision: 1 }]);
    database.close();
    database = openDatabase(options);
    expect(
      createPluginDocuments(database).read(
        channels["plugin.doc.read"].request.assert(
          validateRequest("plugin.doc.read", "pluginHost", ref),
        ),
      ),
    ).toEqual({ value: "saved", revision: 1 });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
