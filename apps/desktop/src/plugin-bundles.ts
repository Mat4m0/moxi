import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";

const indexSchema = type({
  manifest: "string & /^\\/plugins\\/[a-zA-Z0-9.-]+\\.json$/",
  script: "string & /^\\/plugins\\/[a-zA-Z0-9.-]+\\.js$/",
  bytes: "number.safe >= 0",
}).array();

async function readJson(file: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  return parsed;
}

export async function loadPluginBundles(root: string) {
  const raw = await readJson(join(root, "plugins/index.json"));
  return Promise.all(
    indexSchema.assert(raw).map(async (entry) => ({
      manifest: await readJson(join(root, entry.manifest)),
      source: await readFile(join(root, entry.script), "utf8"),
      bytes: entry.bytes,
    })),
  );
}
