import { expect, test } from "vite-plus/test";
import { captureWindow, planWindow, type Rect, type SavedWindow } from "./window-state";

const primary: Rect = { x: 0, y: 25, width: 1920, height: 1055 };
const second: Rect = { x: 1920, y: 0, width: 1280, height: 1024 };
const saved = (over: Partial<SavedWindow> = {}): SavedWindow => ({
  x: 100,
  y: 100,
  width: 1000,
  height: 700,
  fullscreen: false,
  maximized: false,
  ...over,
});

test.each(["launcher", "game"] as const)("the first launch of the %s starts maximized", (kind) => {
  expect(planWindow(kind, null, [primary])).toEqual({
    bounds: { width: 960, height: 640 },
    fullscreen: false,
    maximized: true,
  });
});

test("a saved windowed game stays windowed at its saved size and place", () => {
  expect(planWindow("game", saved(), [primary])).toEqual({
    bounds: { x: 100, y: 100, width: 1000, height: 700 },
    fullscreen: false,
    maximized: false,
  });
});

test("a window left in full screen opens in full screen with the old normal size behind it", () => {
  const normalBounds = { x: 80, y: 90, width: 1100, height: 750 };
  const stored = captureWindow({ normalBounds, fullscreen: true, maximized: false });
  expect(planWindow("game", stored, [primary])).toEqual({
    bounds: normalBounds,
    fullscreen: true,
    maximized: false,
  });
});

test.each([
  ["a display that is no longer plugged in", saved({ x: 4000 }), [primary]],
  ["a window left far above every display", saved({ y: -3000 }), [primary]],
])("%s: the position is dropped and the size kept", (_name, state, displays) => {
  const plan = planWindow("launcher", state, displays);
  expect(plan.bounds).toEqual({ width: 1000, height: 700 });
});

test.each([
  ["tiny", saved({ width: 100, height: 100 }), { width: 640, height: 480 }],
  ["huge", saved({ width: 5000, height: 4000, x: 0, y: 25 }), { width: 1920, height: 1055 }],
])("a %s saved size is brought into range", (_name, state, size) => {
  expect(planWindow("game", state, [primary]).bounds).toMatchObject(size);
});

test("a window half off the left edge is moved back so its title bar can be reached", () => {
  const plan = planWindow("launcher", saved({ x: -400, y: 25 }), [primary]);
  expect(plan.bounds).toEqual({ x: 0, y: 25, width: 1000, height: 700 });
});

test("a window saved on a second display stays there, and the larger overlap wins", () => {
  expect(planWindow("game", saved({ x: 2000, y: 50 }), [primary, second]).bounds).toEqual({
    x: 2000,
    y: 50,
    width: 1000,
    height: 700,
  });
  // Straddling both displays, it moves onto the one that showed more of it.
  const straddling = planWindow("game", saved({ x: 1600, y: 50 }), [primary, second]);
  expect(straddling.bounds.x).toBe(1920);
});

test("a maximized window opens maximized", () => {
  expect(planWindow("launcher", saved({ maximized: true }), [primary]).maximized).toBe(true);
});

test("fractional bounds from the OS are saved as whole numbers", () => {
  expect(
    captureWindow({
      normalBounds: { x: 10.4, y: 20.6, width: 999.5, height: 700.2 },
      fullscreen: false,
      maximized: false,
    }),
  ).toEqual({ x: 10, y: 21, width: 1000, height: 700, fullscreen: false, maximized: false });
});
