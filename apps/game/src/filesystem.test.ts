import { afterEach, expect, test, vi } from "vite-plus/test";
import { mountGameFilesystem, type GameFilesystem } from "./filesystem";

afterEach(() => vi.unstubAllGlobals());

test.each(["restore", "persist", "success"])(
  "holds main until durable template directories exist (%s)",
  (stage) => {
    const calls: unknown[] = [];
    const fs: GameFilesystem = {
      lookupPath: (path) => {
        calls.push(["probe", path]);
        return { exists: true, error: 0 };
      },
      mkdir: (path) => {
        calls.push(["mkdir", path]);
      },
      mount: (_type, options, path) => {
        calls.push(["mount", options, path]);
      },
      mkdirTree: (path) => {
        calls.push(["directory", path]);
      },
      chdir: (path) => {
        calls.push(["cwd", path]);
      },
      syncfs: (populate, done) => {
        calls.push(["sync", populate]);
        done(
          (populate && stage === "restore") || (!populate && stage === "persist")
            ? new Error("Storage unavailable")
            : undefined,
        );
      },
    };
    vi.stubGlobal("FS", fs);
    vi.stubGlobal("IDBFS", {});
    vi.stubGlobal("PATH", { isAbs: (path: string) => path.startsWith("/") });
    mountGameFilesystem(
      {
        addRunDependency: (name) => {
          calls.push(["hold", name]);
        },
        removeRunDependency: (name) => {
          calls.push(["ready", name]);
        },
      },
      () => {
        calls.push("failed");
      },
    );
    const restored = [
      ["hold", "moxi-filesystem"],
      ["mkdir", "app:"],
      ["mount", { autoPersist: true }, "app:"],
      ["sync", true],
    ];
    expect(calls).toEqual(
      stage === "restore"
        ? [...restored, "failed"]
        : [
            ...restored,
            ["directory", "app:/Templates/Skills"],
            ["directory", "app:/Templates/Equipment"],
            ["cwd", "app:"],
            ["sync", false],
            stage === "persist" ? "failed" : ["ready", "moxi-filesystem"],
          ],
    );
  },
);

test("client drive paths stay absolute after chdir instead of mounting or opening under app:/app:", () => {
  const paths: string[] = [];
  vi.stubGlobal("FS", {
    lookupPath(path: string) {
      paths.push(path);
      return { path };
    },
    mkdir() {},
    mount() {},
    mkdirTree() {},
    chdir() {},
    syncfs(_populate: boolean, done: () => void) {
      done();
    },
  } satisfies GameFilesystem);
  vi.stubGlobal("IDBFS", {});
  vi.stubGlobal("PATH", { isAbs: (path: string) => path.startsWith("/") });
  mountGameFilesystem({ addRunDependency() {}, removeRunDependency() {} }, () => {
    throw new Error("Unexpected restore failure");
  });
  expect(FS.lookupPath("app:")).toEqual({ path: "/app:" });
  expect(FS.lookupPath("app:/Gw.dat")).toEqual({ path: "/app:/Gw.dat" });
  expect(FS.lookupPath("Templates/Skills")).toEqual({ path: "Templates/Skills" });
  expect(paths).toEqual(["/app:", "/app:/Gw.dat", "Templates/Skills"]);
  expect(["app:/Gw.dat", "/tmp", "Templates/Skills"].map((path) => PATH.isAbs(path))).toEqual([
    true,
    true,
    false,
  ]);
});
