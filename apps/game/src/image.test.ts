import { afterEach, expect, test, vi } from "vite-plus/test";
import { createImage } from "./image";

afterEach(() => vi.unstubAllGlobals());

test("writes an awaited snapshot read into current memory after growth", async () => {
  const request = Promise.withResolvers<Response>();
  const http = vi.fn<typeof fetch>(() => request.promise);
  vi.stubGlobal("fetch", http);
  const memory = new WebAssembly.Memory({ initial: 1 });
  const image = createImage(5, () => new Uint8Array(memory.buffer));
  const handle = image.open("app:/Gw.snapshot");
  const pending = image.readAsync(handle, 1, null, 7, 3);
  memory.grow(1);
  request.resolve(new Response(new Uint8Array([22, 33, 44]), { status: 206 }));
  await pending;
  expect(http).toHaveBeenCalledWith("moxi://app/client/Gw.snapshot", {
    headers: { Range: "bytes=1-3" },
  });
  expect(Array.from(new Uint8Array(memory.buffer).subarray(7, 10))).toEqual([22, 33, 44]);
  expect(image.fileSize(handle)).toBe(5);
  expect(image.open("app:/ChatFilter.ini")).toBe(0);
  image.close(handle);
  await expect(image.readAsync(handle, 0, null, 0, 1)).rejects.toThrow(
    "The game requested an invalid image range.",
  );
});

test.each([
  [200, [1, 2, 3]],
  [206, [1, 2]],
])(
  "does not copy a failed or truncated range response into game memory (%s)",
  async (status, bytes) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(Uint8Array.from(bytes), { status })),
    );
    const memory = new Uint8Array(8);
    const image = createImage(5, () => memory);
    await expect(image.readAsync(image.open("Gw.snapshot"), 0, null, 0, 3)).rejects.toThrow();
    expect(Array.from(memory)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  },
);

test("reports a range as cached only after it was fetched, across adjacent fetches", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_url, init) => {
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(
        String(new Headers(init?.headers).get("Range")),
      )!;
      return new Response(new Uint8Array(Number(end) - Number(start) + 1), { status: 206 });
    }),
  );
  const image = createImage(100, () => new Uint8Array(0));
  const handle = image.open("Gw.snapshot");
  const cached = () =>
    [
      [0, 10],
      [10, 10],
      [0, 20],
      [5, 20],
      [40, 1],
    ].map(([offset, length]) => image.isCached(handle, offset!, length!));
  expect(cached()).toEqual([0, 0, 0, 0, 0]);
  await image.cacheAsync(handle, 0, 10, () => {});
  await image.cacheAsync(handle, 10, 20, () => {});
  expect(cached()).toEqual([1, 1, 1, 1, 0]);
});
