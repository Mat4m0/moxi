(() => {
  const module = globalThis.Module;
  const dependencies = new Set();
  let ready;
  module.addRunDependency = (name) => dependencies.add(name);
  module.removeRunDependency = (name) => {
    dependencies.delete(name);
    if (!dependencies.size) ready?.();
  };
  // The fixture has an empty virtual drive; no player files are read or written.
  const directories = new Set(["/"]);
  globalThis.FS = {
    lookupPath: (path) => {
      if (!directories.has(path)) throw new Error("Missing fixture directory");
      return { path };
    },
    mkdir: (path) => directories.add(path),
    mkdirTree: (path) => directories.add(path),
    mount() {},
    chdir() {},
    syncfs(_populate, callback) {
      queueMicrotask(() => callback());
    },
  };
  globalThis.IDBFS = {};
  globalThis.PATH = { isAbs: (path) => path.startsWith("/") };
  module.instantiateWasm({}, (instance) => {
    const main = WebAssembly.promising(instance.exports.main);
    const loop = WebAssembly.promising(instance.exports.EmscriptenExeThreadMainLoop);
    const restored = new Promise((resolve) => {
      ready = resolve;
    });
    module.preRun();
    if (!dependencies.size) ready();
    void restored.then(async () => {
      await main();
      const canvas = module.canvas;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Fixture canvas is unavailable");
      let frames = 0;
      async function frame() {
        await loop();
        frames++;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        context.fillStyle = "#102030";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#e8eef4";
        context.font = "32px sans-serif";
        context.fillText("Fixture client", 40, 70);
        context.font = "20px monospace";
        context.fillText(`Frame ${frames}`, 40, 110);
        if (frames === 1) {
          module.onRuntimeInitialized();
          module.setStartupProgress("complete");
        }
        requestAnimationFrame(() => void frame());
      }
      requestAnimationFrame(() => void frame());
    });
  });
})();
