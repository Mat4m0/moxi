const asyncExports = [
  "EmscriptenExeFileOnInitCompleteDispatch",
  "EmscriptenExeThreadMainLoop",
  "EmscriptenExeTimerRunTimers",
  "main",
  "__main_argc_argv",
];

declare global {
  namespace WebAssembly {
    function promising(fn: Function): (...args: unknown[]) => Promise<unknown>;
  }
}

let installed = false;

export function createRuntime() {
  if (installed) throw new Error("A game runtime already owns WebAssembly.promising.");
  if (typeof WebAssembly.promising !== "function")
    throw new Error("This browser needs JSPI support.");
  const promising = WebAssembly.promising;
  const functions = new Set<Function>();
  const callbacks = new Set<() => void>();
  let mainLoop: Function | undefined;
  let heap: WebAssembly.Memory | undefined;
  let inFlight = 0;
  let pendingFrames = 0;
  let frameCount = 0;
  let disposed = false;
  let notifying = false;

  function settled(frame: boolean) {
    inFlight--;
    if (frame) pendingFrames++;
    if (notifying || disposed) return;
    notifying = true;
    try {
      while (inFlight === 0 && pendingFrames > 0 && !disposed) {
        pendingFrames--;
        frameCount++;
        for (const callback of callbacks) callback();
      }
    } finally {
      notifying = false;
    }
  }

  // The glue wraps both exports and raw table entries through this same seam.
  const track: typeof promising = (fn) => {
    const call = promising(fn);
    if (!functions.has(fn)) return call;
    return (...args) => {
      if (disposed) return call(...args);
      inFlight++;
      let result: Promise<unknown>;
      try {
        result = call(...args);
      } catch (error) {
        settled(false);
        throw error;
      }
      return Promise.resolve(result).then(
        (value) => {
          settled(fn === mainLoop);
          return value;
        },
        (error: unknown) => {
          settled(false);
          throw error;
        },
      );
    };
  };
  WebAssembly.promising = track;
  installed = true;

  return {
    async instantiateWasm(
      imports: WebAssembly.Imports,
      success: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
      bytes: BufferSource | WebAssembly.Module,
    ) {
      const result =
        bytes instanceof WebAssembly.Module
          ? { instance: await WebAssembly.instantiate(bytes, imports), module: bytes }
          : await WebAssembly.instantiate(bytes, imports);
      if (disposed) throw new Error("The game runtime has stopped.");
      for (const name of asyncExports) {
        const fn = result.instance.exports[name];
        if (typeof fn === "function") functions.add(fn);
      }
      const loop = result.instance.exports.EmscriptenExeThreadMainLoop;
      const memory = result.instance.exports.memory;
      if (typeof loop !== "function" || !(memory instanceof WebAssembly.Memory))
        throw new Error("The game client has no main loop or memory.");
      mainLoop = loop;
      heap = memory;
      success(result.instance, result.module);
    },
    onSafePoint(fn: () => void) {
      if (disposed) throw new Error("The game runtime has stopped.");
      callbacks.add(fn);
      return () => {
        callbacks.delete(fn);
      };
    },
    frames: () => frameCount,
    memory() {
      if (!heap || disposed) throw new Error("The game memory is unavailable.");
      return new Uint8Array(heap.buffer);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      callbacks.clear();
      WebAssembly.promising = promising;
      installed = false;
    },
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
