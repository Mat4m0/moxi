import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createTestHost } from "@moxi/sdk/testing";
import type { Manifest } from "@moxi/sdk";
import plugin from "./index.ts";
import manifest from "./plugin.json";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("currency", () => {
  test.each([
    ["10 ecto in p", "10 Globs of Ectoplasm = 82 platinum"],
    ["2.5 p to g", "2.5 platinum = 2500 gold"],
    ["100k in plat", "100000 gold = 100 platinum"],
  ])("%s", async (query, title) => {
    const host = await settle(createTestHost(manifest as Manifest, plugin));
    expect((await settle(host.query(query))).map((i) => i.title)).toEqual([title]);
  });

  test("ignores text that is not a conversion", async () => {
    const host = await settle(createTestHost(manifest as Manifest, plugin));
    expect(await settle(host.query("build smiter"))).toEqual([]);
  });
});
