import { expect, test } from "vite-plus/test";
import { createGameWindows } from "./game-windows";

const playable = new Set(["main", "storage"]);

test("two accounts get two windows, and an account that is already open is shown, not opened again", () => {
  const windows = createGameWindows();
  expect(windows.play(["main", "storage"], playable)).toEqual([
    { accountId: "main", do: "open" },
    { accountId: "storage", do: "open" },
  ]);
  windows.opened("storage");
  expect(windows.play(["main", "storage"], playable)).toEqual([
    { accountId: "main", do: "open" },
    { accountId: "storage", do: "show" },
  ]);
});

test("an unknown or archived account is never opened, and a repeated id is played once", () => {
  const windows = createGameWindows();
  expect(windows.play(["main", "main", "archived", "ghost"], playable)).toEqual([
    { accountId: "main", do: "open" },
  ]);
});

test("closing one account's window leaves the other running", () => {
  const windows = createGameWindows();
  windows.opened("main");
  windows.opened("storage");
  windows.ended("main", false);
  expect(windows.state("main")).toEqual({ state: "closed" });
  expect(windows.state("storage")).toEqual({ state: "running" });
  expect(windows.running("main")).toBe(false);
});

test("a crash is reported until the account is opened again", () => {
  const windows = createGameWindows();
  windows.opened("main");
  windows.ended("main", true);
  expect(windows.state("main")).toEqual({ state: "failed", failure: "renderer-crash" });
  expect(windows.play(["main"], playable)).toEqual([{ accountId: "main", do: "open" }]);
  windows.opened("main");
  expect(windows.state("main")).toEqual({ state: "running" });
});

test("an account that was never opened is closed, and a removed account is forgotten", () => {
  const windows = createGameWindows();
  expect(windows.state("main")).toEqual({ state: "closed" });
  windows.opened("main");
  windows.forget("main");
  expect(windows.state("main")).toEqual({ state: "closed" });
});
