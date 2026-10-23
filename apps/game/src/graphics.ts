// Presentation of the official client's frames. The client draws with WebGL through its EGL
// imports. Drawn straight into the visible canvas, a frame the compositor shows half-cleared makes
// the whole interface flicker when windows open and close. The client therefore draws into an
// OffscreenCanvas of the same size, and each finished frame is handed to the visible canvas as one
// ImageBitmap. When the browser cannot do this, the imports stay untouched and the client draws
// directly: the game stays playable.
type Call = (...args: unknown[]) => unknown;

export interface Surface {
  width: number;
  height: number;
}
export interface OffscreenSurface extends Surface {
  addEventListener(type: "webglcontextlost", listener: (event: Event) => void): void;
  transferToImageBitmap(): ImageBitmap;
}
export interface BitmapTarget {
  transferFromImageBitmap(bitmap: ImageBitmap | null): void;
}
export interface PresentationHost {
  supported(): boolean;
  createOffscreen(width: number, height: number): OffscreenSurface;
  bitmapTarget(visible: Surface): BitmapTarget | null;
}

export const browserHost: PresentationHost = {
  supported: () =>
    typeof OffscreenCanvas === "function" &&
    typeof OffscreenCanvas.prototype.transferToImageBitmap === "function" &&
    document.createElement("canvas").getContext("bitmaprenderer") !== null,
  createOffscreen: (width, height) => new OffscreenCanvas(width, height),
  bitmapTarget: (visible) =>
    visible instanceof HTMLCanvasElement ? visible.getContext("bitmaprenderer") : null,
};

function importOf(env: WebAssembly.ModuleImports | undefined, name: string): Call | undefined {
  const value = env?.[name];
  return typeof value === "function" ? (value as Call) : undefined;
}

// Returns whether frames are presented through the offscreen canvas.
export function installOffscreenPresentation({
  env,
  module,
  log,
  host = browserHost,
}: {
  env: WebAssembly.ModuleImports | undefined;
  module: { canvas: Surface };
  log: (text: string) => void;
  host?: PresentationHost;
}): boolean {
  const createContext = importOf(env, "eglCreateContext");
  const swap = importOf(env, "eglSwapBuffers");
  const setSize = importOf(env, "emscripten_set_canvas_element_size");
  if (!env || !createContext || !swap) {
    log("The client has no EGL imports to present through; drawing directly.");
    return false;
  }
  if (!host.supported()) {
    log("Offscreen presentation is unavailable; drawing directly.");
    return false;
  }

  let offscreen: OffscreenSurface | undefined;
  let target: BitmapTarget | undefined;
  let reported = false;

  env.eglCreateContext = (...args: unknown[]) => {
    const visible = module.canvas;
    const surface = host.createOffscreen(visible.width, visible.height);
    // Keep the context restorable; the client rebuilds its own state when it comes back.
    surface.addEventListener("webglcontextlost", (event) => event.preventDefault());
    module.canvas = surface;
    let context: unknown;
    try {
      context = createContext(...args);
    } finally {
      module.canvas = visible;
    }
    const bitmap = context ? host.bitmapTarget(visible) : null;
    if (context && bitmap) {
      offscreen = surface;
      target = bitmap;
      return context;
    }
    log("The offscreen canvas could not start; drawing directly.");
    offscreen = undefined;
    target = undefined;
    return createContext(...args);
  };

  env.eglSwapBuffers = (...args: unknown[]) => {
    const done = swap(...args);
    if (done && offscreen && target) {
      try {
        const frame = offscreen.transferToImageBitmap();
        try {
          target.transferFromImageBitmap(frame);
        } finally {
          frame.close();
        }
      } catch (error) {
        if (!reported) log(`A frame could not be presented: ${String(error)}`);
        reported = true;
      }
    }
    return done;
  };

  // The client sizes the visible canvas; the canvas it draws into follows.
  if (setSize) {
    env.emscripten_set_canvas_element_size = (...args: unknown[]) => {
      const result = setSize(...args);
      const [, width, height] = args;
      if (
        result === 0 &&
        offscreen &&
        typeof width === "number" &&
        typeof height === "number" &&
        (offscreen.width !== width || offscreen.height !== height)
      ) {
        offscreen.width = width;
        offscreen.height = height;
      }
      return result;
    };
  }
  return true;
}
