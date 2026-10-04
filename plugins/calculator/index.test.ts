import { describe, expect, test } from "vite-plus/test";
import { parseManifest } from "@moxi/sdk/host";
import { createTestHost } from "@moxi/sdk/testing";
import plugin from "./index.ts";
import manifest from "./plugin.json";

describe("currency", () => {
  test.each([
    ["10 ecto in p", "10 Globs of Ectoplasm = 82 platinum"],
    ["2.5 p to g", "2.5 platinum = 2500 gold"],
    ["100k in plat", "100000 gold = 100 platinum"],
  ])("%s", async (query, title) => {
    const host = await createTestHost(manifest, plugin);
    expect((await host.query(query)).map((i) => i.title)).toEqual([title]);
  });

  test("ignores text that is not a conversion", async () => {
    const host = await createTestHost(manifest, plugin);
    expect(await host.query("build smiter")).toEqual([]);
  });
});

test("accepts the bundled manifest without author casts", () => {
  expect(parseManifest(manifest)).toEqual(manifest);
});
