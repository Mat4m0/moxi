import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createRuntime } from "./index";

let runtime: ReturnType<typeof createRuntime>;
const original = WebAssembly;
const promising =
  (fn: Function) =>
  (...args: unknown[]): Promise<unknown> =>
    Promise.resolve(Reflect.apply(fn, undefined, args));
const emptyModule = new original.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));

beforeEach(() => {
  vi.stubGlobal("WebAssembly", {
    ...original,
    Module: original.Module,
    Memory: original.Memory,
    instantiate: vi.fn(),
    promising,
  });
  runtime = createRuntime();
});
afterEach(() => {
  runtime.dispose();
  vi.unstubAllGlobals();
});

async function client(exports: Record<string, WebAssembly.ExportValue>) {
  vi.mocked(WebAssembly.instantiate).mockResolvedValue({ exports });
  await runtime.instantiateWasm({}, () => {}, emptyModule);
}

test("does not expose a safe point while a main-loop frame is suspended", async () => {
  const frame = Promise.withResolvers<number>();
  const loop = () => frame.promise;
  await client({
    EmscriptenExeThreadMainLoop: loop,
    memory: new WebAssembly.Memory({ initial: 1 }),
  });
  const points: number[] = [];
  runtime.onSafePoint(() => points.push(runtime.frames()));
  const pending = WebAssembly.promising(loop)();
  await Promise.resolve();
  expect(points).toEqual([]);
  expect(runtime.frames()).toBe(0);
  frame.resolve(7);
  expect(await pending).toBe(7);
  expect(points).toEqual([1]);
});

test("waits for nested async exports and counts each settled loop only once", async () => {
  const nested = Promise.withResolvers<void>();
  const timer = () => nested.promise;
  let pendingTimer: Promise<unknown> | undefined;
  const loop = () => {
    pendingTimer = WebAssembly.promising(timer)();
    return Promise.resolve(3);
  };
  await client({
    EmscriptenExeThreadMainLoop: loop,
    EmscriptenExeTimerRunTimers: timer,
    memory: new WebAssembly.Memory({ initial: 1 }),
  });
  const points: number[] = [];
  const unsubscribe = runtime.onSafePoint(() => points.push(runtime.frames()));
  await WebAssembly.promising(loop)();
  expect(points).toEqual([]);
  nested.resolve();
  await pendingTimer;
  expect(points).toEqual([1]);
  unsubscribe();
  await WebAssembly.promising(loop)();
  expect(runtime.frames()).toBe(2);
  expect(points).toEqual([1]);
});

test.each(["reject", "throw"])(
  "a %s does not double-decrement the counter or count a failed frame",
  async (failure) => {
    const waiting = Promise.withResolvers<void>();
    const timer = () => waiting.promise;
    const loop = () => {
      if (failure === "throw") throw new Error("client failed");
      return Promise.reject(new Error("client failed"));
    };
    await client({
      EmscriptenExeThreadMainLoop: loop,
      EmscriptenExeTimerRunTimers: timer,
      memory: new WebAssembly.Memory({ initial: 1 }),
    });
    const point = vi.fn();
    runtime.onSafePoint(point);
    const pending = WebAssembly.promising(timer)();
    try {
      await WebAssembly.promising(loop)();
    } catch (error) {
      expect(error).toEqual(new Error("client failed"));
    }
    expect(point).not.toHaveBeenCalled();
    waiting.resolve();
    await pending;
    expect(runtime.frames()).toBe(0);
    expect(point).not.toHaveBeenCalled();
    const goodLoop = () => Promise.resolve();
    await client({
      EmscriptenExeThreadMainLoop: goodLoop,
      memory: new WebAssembly.Memory({ initial: 1 }),
    });
    await WebAssembly.promising(goodLoop)();
    expect(point).toHaveBeenCalledTimes(1);
    expect(runtime.frames()).toBe(1);
  },
);

test("tracks raw main-loop table entries as well as exported wrappers", async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const loop = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await client({
    EmscriptenExeThreadMainLoop: loop,
    memory: new WebAssembly.Memory({ initial: 1 }),
  });
  const points: number[] = [];
  runtime.onSafePoint(() => points.push(runtime.frames()));
  const exported = WebAssembly.promising(loop)();
  const tableEntry = WebAssembly.promising(loop)();
  first.resolve();
  await exported;
  expect(points).toEqual([]);
  second.resolve();
  await tableEntry;
  expect(points).toEqual([1, 2]);
});

test("refreshes the memory view after growth and restores promising on disposal", async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const loop = () => Promise.resolve();
  await client({ EmscriptenExeThreadMainLoop: loop, memory });
  runtime.memory()[0] = 23;
  memory.grow(1);
  expect(runtime.memory().length).toBe(131072);
  expect(runtime.memory()[0]).toBe(23);
  const point = vi.fn();
  runtime.onSafePoint(point);
  const pending = WebAssembly.promising(loop)();
  runtime.dispose();
  await pending;
  expect(point).not.toHaveBeenCalled();
  expect(WebAssembly.promising).toBe(promising);
});
