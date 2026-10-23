import "./hub/main.ts";
import type { Bridge } from "@moxi/contracts";
import { createRuntime } from "@moxi/gwkit";
import { mountGameFilesystem } from "./filesystem";
import { createSocketHost } from "./socket-host";
import { installOffscreenPresentation } from "./graphics";
import { createImage } from "./image";
import { installWebRewrite } from "./web";
import { installGameInput, type OskInput } from "./input";

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
  socket: ReturnType<typeof createSocketHost>["socket"];
  dns: { resolve(name: string): Promise<string> };
  oskInput: OskInput;
  oskIsModal: boolean;
  oskActiveInput?: unknown;
  oskIsActive?: boolean;
  getPatchMode(): Promise<string>;
  handleFatalReadError(): void;
  secureStorage: {
    getCredentials(): Promise<never>;
    storeCredentials(): Promise<void>;
    clearCredentials(): Promise<void>;
  };
  login: { hasProvider(name: unknown): boolean; getAuthToken(): Promise<never> };
  nativeAccount: { storeAccountData(): Promise<void>; clearAccountData(): Promise<void> };
  setBuildInfo(info: { programId: unknown; buildId: unknown }): void;
  isMobile: boolean;
  requestFullScreen(): void;
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
let network: ReturnType<typeof createSocketHost> | undefined;
let input: ReturnType<typeof installGameInput> | undefined;
let clientToken: string | undefined;
let sessionEnded = false;
let frameLog: ReturnType<typeof setInterval> | undefined;
function fail(text: string) {
  sessionEnded = true;
  if (clientToken)
    void window.moxi
      .invoke("game.client.failed", clientToken)
      .catch(() => console.warn("[moxi] Client failure could not be reported."));
  message.hidden = false;
  message.textContent = text;
  clearInterval(frameLog);
}

async function boot() {
  const client = await window.moxi.invoke("game.client", undefined);
  clientToken = client.generationToken;
  const game = createRuntime();
  runtime = game;
  let confirmed = false;
  let pending = false;
  let lastAttempt = -Infinity;
  function reportHealth() {
    if (sessionEnded || confirmed || pending || Date.now() - lastAttempt < 1000) return;
    lastAttempt = Date.now();
    pending = true;
    void window.moxi
      .invoke("game.net.healthy", { token: client.generationToken, frame: game.frames() > 0 })
      .then((healthy) => {
        confirmed = healthy;
      })
      .catch(() => console.warn("[moxi] Client health could not be confirmed."))
      .finally(() => {
        pending = false;
      });
  }
  game.onSafePoint(reportHealth);
  network = createSocketHost(window.moxi, reportHealth);
  input = installGameInput(
    canvas,
    () => Module.oskActiveInput,
    () => Boolean(Module.oskIsActive),
  );
  globalThis.Module = {
    canvas,
    oskInput: input.oskInput,
    oskIsModal: false,
    preRun() {
      mountGameFilesystem(Module, () =>
        fail("Your saved game files could not be restored or saved. Restart Moxi to try again."),
      );
    },
    instantiateWasm(imports, success) {
      installOffscreenPresentation({
        env: imports.env,
        module: Module,
        log: (text) => console.info("[client]", text),
      });
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
    socket: network.socket,
    dns: { resolve: (name) => window.moxi.invoke("game.dns", name) },
    async getPatchMode() {
      return "onDemand";
    },
    // The glue's missing-method branches call their fallback without returning, so all of these
    // must exist. Moxi saves no credentials yet (the player types them) and offers no Steam login.
    secureStorage: {
      getCredentials: () => Promise.reject(new Error("No stored credentials.")),
      storeCredentials: async () => {},
      clearCredentials: async () => {},
    },
    login: {
      hasProvider: () => false,
      getAuthToken: () => Promise.reject(new Error("No login provider is offered.")),
    },
    nativeAccount: { storeAccountData: async () => {}, clearAccountData: async () => {} },
    setBuildInfo: (info) =>
      console.info(
        `[client] build program=${Number(info.programId)} build=${Number(info.buildId)}`,
      ),
    isMobile: false,
    requestFullScreen: () => void canvas.requestFullscreen?.(),
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
  installWebRewrite();
  frameLog = setInterval(() => console.info(`[gwkit] frames=${game.frames()}`), 1000);
  const glue = document.createElement("script");
  glue.src = "moxi://app/client/Gw.jspi.js";
  glue.onerror = () => fail("The game client could not load. Run fetch-client and restart Moxi.");
  document.body.append(glue);
}
window.addEventListener(
  "pagehide",
  () => {
    sessionEnded = true;
    clearInterval(frameLog);
    input?.dispose();
    network?.dispose();
    runtime?.dispose();
  },
  { once: true },
);
void boot().catch(() => fail("The game client is unavailable. Run fetch-client and restart Moxi."));
