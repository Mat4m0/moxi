import "./hub/main.ts";
import type { Bridge } from "@moxi/contracts";
import { createRuntime } from "@moxi/gwkit";
import { mountGameFilesystem } from "./filesystem";
import { createImage } from "./image";

type GameModule = {
  canvas: HTMLCanvasElement;
  preRun(): void;
  instantiateWasm(
    imports: WebAssembly.Imports,
    success: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ): object;
  locateFile(path: string): string;
  print(text: unknown): void;
  printErr(text: unknown): void;
  onAbort(reason: unknown): void;
  onRuntimeInitialized(): void;
  image: ReturnType<typeof createImage>;
  socket: {
    connect(destination: string): {
      onopen: (() => void) | null;
      onclose: (() => void) | null;
      onmessage: ((bytes: Uint8Array) => void) | null;
      send(): void;
      close(): void;
    };
  };
  dns: { resolve(name: string): Promise<string> };
  getPatchMode(): Promise<string>;
  handleFatalReadError(): void;
  setStartupProgress(stage: unknown): void;
  addRunDependency(name: string): void;
  removeRunDependency(name: string): void;
};

declare global {
  var Module: GameModule;
  interface Window {
    moxi: Bridge<"game">;
  }
}

const element = document.querySelector("canvas");
const status = document.querySelector("[role=status]");
if (!element || !(status instanceof HTMLElement)) throw new Error("The game canvas is missing.");
const canvas = element;
const message = status;
let runtime: ReturnType<typeof createRuntime> | undefined;
let frameLog: ReturnType<typeof setInterval> | undefined;
function fail(text: string) {
  message.hidden = false;
  message.textContent = text;
  clearInterval(frameLog);
}

async function boot() {
  const client = await window.moxi.invoke("game.client", undefined);
  const game = createRuntime();
  runtime = game;
  globalThis.Module = {
    canvas,
    preRun() {
      mountGameFilesystem(Module, () =>
        fail("Your saved game files could not be restored or saved. Restart Moxi to try again."),
      );
    },
    instantiateWasm(imports, success) {
      void WebAssembly.compileStreaming(fetch("moxi://app/client/Gw.jspi.wasm"))
        .then((bytes) => game.instantiateWasm(imports, success, bytes))
        .catch(() => fail("The game client could not start. Run fetch-client and restart Moxi."));
      return {};
    },
    locateFile: (path) => `moxi://app/client/${path}`,
    print: (text) => console.info("[client]", text),
    printErr: (text) => console.warn("[client]", text),
    onAbort: () => fail("The game client stopped. Restart Moxi to try again."),
    onRuntimeInitialized() {
      canvas.focus();
    },
    image: createImage(client.snapshotSize, () => game.memory()),
    socket: {
      connect(destination) {
        console.info(`[moxi] connection failed (F2 unavailable): ${destination}`);
        message.hidden = false;
        message.textContent = "Could not connect to the game servers. Restart Moxi to try again.";
        let closed = false;
        const socket: ReturnType<GameModule["socket"]["connect"]> = {
          onopen: null,
          onclose: null,
          onmessage: null,
          send() {},
          close() {
            if (!closed) {
              closed = true;
              socket.onclose?.();
            }
          },
        };
        queueMicrotask(() => socket.close());
        return socket;
      },
    },
    dns: {
      async resolve(name) {
        console.info(`[moxi] DNS unavailable (F2): ${name}`);
        // A sentinel reaches the client's connection-failure path without a DNS lookup.
        return "192.0.2.1";
      },
    },
    async getPatchMode() {
      return "onDemand";
    },
    handleFatalReadError() {
      fail("The game files could not be read. Run fetch-client and restart Moxi.");
    },
    setStartupProgress(stage) {
      console.info("[client] startup", stage);
      if (stage === "complete") message.hidden = true;
    },
    // The glue installs these before preRun; early use is an invariant failure.
    addRunDependency() {
      throw new Error("The game runtime is not initialized.");
    },
    removeRunDependency() {
      throw new Error("The game runtime is not initialized.");
    },
  };
  frameLog = setInterval(() => console.info(`[gwkit] frames=${game.frames()}`), 1000);
  const glue = document.createElement("script");
  glue.src = "moxi://app/client/Gw.jspi.js";
  glue.onerror = () => fail("The game client could not load. Run fetch-client and restart Moxi.");
  document.body.append(glue);
}
window.addEventListener(
  "pagehide",
  () => {
    clearInterval(frameLog);
    runtime?.dispose();
  },
  { once: true },
);
void boot().catch(() => fail("The game client is unavailable. Run fetch-client and restart Moxi."));
