import { expect, test } from "vite-plus/test";
import {
  installOffscreenPresentation,
  type BitmapTarget,
  type OffscreenSurface,
  type PresentationHost,
} from "./graphics";

function setup(
  options: { supported?: boolean; offscreenContext?: boolean; failFrame?: boolean } = {},
) {
  const visible = { width: 960, height: 640 };
  const module: { canvas: { width: number; height: number } } = { canvas: visible };
  const events: string[] = [];
  const logs: string[] = [];
  const offscreen = {
    width: 960,
    height: 640,
    addEventListener() {},
    transferToImageBitmap() {
      if (options.failFrame) throw new Error("detached");
      const frame: ImageBitmap = {
        width: 960,
        height: 640,
        close: () => void events.push("closed"),
      };
      return frame;
    },
  } satisfies OffscreenSurface;
  const target: BitmapTarget = { transferFromImageBitmap: () => events.push("presented") };
  const host: PresentationHost = {
    supported: () => options.supported ?? true,
    createOffscreen: () => offscreen,
    bitmapTarget: () => target,
  };
  const drawnOn: unknown[] = [];
  type Env = {
    eglCreateContext: () => unknown;
    eglSwapBuffers: () => unknown;
    emscripten_set_canvas_element_size: (target: number, width: number, height: number) => unknown;
  };
  const env: Env = {
    eglCreateContext: () => {
      drawnOn.push(module.canvas);
      return module.canvas === offscreen && options.offscreenContext === false ? 0 : 1;
    },
    eglSwapBuffers: () => 1,
    emscripten_set_canvas_element_size: () => 0,
  };
  const original = { ...env };
  const installed = installOffscreenPresentation({ env, module, log: (t) => logs.push(t), host });
  return { visible, offscreen, module, env, original, installed, events, logs, drawnOn };
}

test("the client draws into the offscreen canvas and the visible canvas gets each finished frame", () => {
  const { env, module, visible, offscreen, drawnOn, events, installed } = setup();
  expect(installed).toBe(true);
  expect(env.eglCreateContext()).toBe(1);
  expect(drawnOn).toEqual([offscreen]);
  // The client keeps seeing the visible canvas for sizing and input.
  expect(module.canvas).toBe(visible);
  expect(env.eglSwapBuffers()).toBe(1);
  expect(events).toEqual(["presented", "closed"]);
});

test("a resize of the visible canvas resizes the canvas the client draws into", () => {
  const { env, offscreen } = setup();
  env.eglCreateContext();
  expect(env.emscripten_set_canvas_element_size(0, 1280, 800)).toBe(0);
  expect([offscreen.width, offscreen.height]).toEqual([1280, 800]);
});

test("a browser without offscreen presentation leaves every import untouched", () => {
  const { env, original, installed, logs } = setup({ supported: false });
  expect(installed).toBe(false);
  expect(env.eglCreateContext).toBe(original.eglCreateContext);
  expect(env.eglSwapBuffers).toBe(original.eglSwapBuffers);
  expect(logs).toEqual(["Offscreen presentation is unavailable; drawing directly."]);
});

test("when the offscreen context cannot start the client draws directly and nothing is presented twice", () => {
  const { env, visible, offscreen, drawnOn, events, logs } = setup({ offscreenContext: false });
  expect(env.eglCreateContext()).toBe(1);
  expect(drawnOn).toEqual([offscreen, visible]);
  env.eglSwapBuffers();
  expect(events).toEqual([]);
  expect(logs).toEqual(["The offscreen canvas could not start; drawing directly."]);
});

test("a frame that cannot be presented is reported once and the client keeps running", () => {
  const { env, logs } = setup({ failFrame: true });
  env.eglCreateContext();
  expect(env.eglSwapBuffers()).toBe(1);
  expect(env.eglSwapBuffers()).toBe(1);
  expect(logs).toEqual(["A frame could not be presented: Error: detached"]);
});

test("a client without EGL imports is left alone", () => {
  const logs: string[] = [];
  const installed = installOffscreenPresentation({
    env: {},
    module: { canvas: { width: 1, height: 1 } },
    log: (t) => logs.push(t),
  });
  expect(installed).toBe(false);
  expect(logs).toHaveLength(1);
});
