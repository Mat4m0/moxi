// Runs inside a game window (main world, page CSP applies). Main injects it once with
// webContents.executeJavaScript and then calls the functions on globalThis.__pb14.
// Every function catches its own errors so one failing API never hides the others.
(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const hex = (buffer) =>
    [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const sha256 = async (buffer) => hex(await crypto.subtle.digest("SHA-256", buffer));
  const guard = async (work) => {
    try {
      return await work();
    } catch (error) {
      return { error: String((error && error.message) || error), name: error && error.name };
    }
  };

  async function get(path, init) {
    const response = await fetch("moxi://app" + path, init);
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      bytes: body.byteLength,
      sha256: await sha256(body),
      partition: response.headers.get("x-probe-partition"),
      type: response.headers.get("content-type"),
      csp: response.headers.get("content-security-policy"),
      text: body.byteLength < 120 ? decoder.decode(body) : undefined,
    };
  }

  // IDBFS (Emscripten) keeps the virtual drive in this IndexedDB database. The fixture glue stubs
  // IDBFS, so the probe writes the same layout itself: name, version, store and entry shape.
  const dbName = () => "EM_FS_" + location.pathname;
  const markerKey = "app:/PB14.marker";
  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName(), 21);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains("FILE_DATA")
          ? request.transaction.objectStore("FILE_DATA")
          : db.createObjectStore("FILE_DATA");
        if (!store.indexNames.contains("timestamp"))
          store.createIndex("timestamp", "timestamp", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
    });
  }
  const finish = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  // Hand-assembled module: imports env.wait (a JSPI suspending import) and exports run(), which
  // returns wait() + 1.
  const jspiModule = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x02,
    0x0c, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x04, 0x77, 0x61, 0x69, 0x74, 0x00, 0x00, 0x03, 0x02, 0x01,
    0x00, 0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x01, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x10,
    0x00, 0x41, 0x01, 0x6a, 0x0b,
  ]);

  globalThis.__pb14 = {
    async identity() {
      return {
        href: location.href,
        origin: location.origin,
        secure: isSecureContext,
        glue: globalThis.__PB14_GLUE ?? null,
        wasm: globalThis.__PB14_WASM ?? null,
        statusHidden: document.querySelector("[role=status]")?.hidden ?? null,
        jspi: {
          promising: typeof WebAssembly.promising,
          suspending: typeof WebAssembly.Suspending,
        },
        ua: navigator.userAgent,
      };
    },

    // What this window receives from its protocol handler right now.
    async hashes(ranges) {
      return guard(async () => {
        const out = { glue: await get("/client/Gw.jspi.js"), wasm: await get("/client/Gw.jspi.wasm") };
        for (const range of ranges)
          out["snapshot " + range] = await get("/client/Gw.snapshot", {
            headers: { Range: "bytes=" + range },
          });
        const module = await WebAssembly.compileStreaming(fetch("moxi://app/client/Gw.jspi.wasm"));
        const section = WebAssembly.Module.customSections(module, "pb14")[0];
        out.compiledStamp = section ? decoder.decode(section).slice(0, 1) : null;
        return out;
      });
    },

    // Which routes this partition's handler serves, and which it refuses.
    async routes(self) {
      const out = {};
      for (const path of [
        "/probe/who",
        "/probe/a",
        "/probe/b",
        "/launcher/",
        "/plugin-host/",
        "/client/nope",
        "/game/",
      ])
        out[path] = await guard(async () => {
          const result = await get(path);
          return { status: result.status, partition: result.partition, text: result.text };
        });
      out.self = self;
      return out;
    },

    async storageWrite(account, nonce) {
      const value = account + ":" + nonce;
      const out = {};
      out.idb = await guard(async () => {
        const db = await openDb();
        try {
          const transaction = db.transaction(["FILE_DATA"], "readwrite");
          const done = new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
          });
          transaction
            .objectStore("FILE_DATA")
            .put({ timestamp: new Date(), mode: 33206, contents: encoder.encode(value) }, markerKey);
          await done;
          return { wrote: value, db: dbName() };
        } finally {
          db.close();
        }
      });
      out.localStorage = await guard(async () => {
        localStorage.setItem("pb14", value);
        return { wrote: value };
      });
      out.cache = await guard(async () => {
        const cache = await caches.open("pb14");
        await cache.put("moxi://app/pb14-marker", new Response(value));
        return { wrote: value };
      });
      out.cookie = await guard(async () => {
        document.cookie = "pb14=" + account + "; path=/; max-age=3600";
        return { wrote: account };
      });
      return out;
    },

    async storageRead() {
      const out = {};
      out.idb = await guard(async () => {
        const db = await openDb();
        try {
          const store = db.transaction(["FILE_DATA"], "readonly").objectStore("FILE_DATA");
          const keys = await finish(store.getAllKeys());
          const entry = await finish(store.get(markerKey));
          return {
            db: dbName(),
            keys,
            marker: entry ? decoder.decode(entry.contents) : null,
          };
        } finally {
          db.close();
        }
      });
      out.databases = await guard(async () => (await indexedDB.databases()).map((db) => db.name));
      out.localStorage = await guard(async () => localStorage.getItem("pb14"));
      out.cache = await guard(async () => {
        const names = await caches.keys();
        const cache = names.includes("pb14") ? await caches.open("pb14") : null;
        const response = cache ? await cache.match("moxi://app/pb14-marker") : undefined;
        return { names, marker: response ? await response.text() : null };
      });
      out.cookie = await guard(async () => document.cookie);
      return out;
    },

    // Several suspended stacks at once in this window. The caller starts both windows together.
    async jspi(delayMs, copies) {
      return guard(async () => {
        if (typeof WebAssembly.promising !== "function" || typeof WebAssembly.Suspending !== "function")
          throw new Error("JSPI API missing");
        const imports = {
          env: {
            wait: new WebAssembly.Suspending(
              () => new Promise((resolve) => setTimeout(() => resolve(41), delayMs)),
            ),
          },
        };
        const { instance } = await WebAssembly.instantiate(jspiModule, imports);
        const run = WebAssembly.promising(instance.exports.run);
        const start = Date.now();
        const t0 = performance.now();
        const results = await Promise.all(Array.from({ length: copies }, () => run()));
        return { start, end: Date.now(), ms: performance.now() - t0, results };
      });
    },

    // Per-partition permission and CSP behaviour as the page sees it.
    async policy() {
      const out = {};
      out.notificationsQuery = await guard(
        async () => (await navigator.permissions.query({ name: "notifications" })).state,
      );
      out.notificationsRequest = await guard(async () =>
        typeof Notification === "undefined" ? "unavailable" : await Notification.requestPermission(),
      );
      out.geolocationQuery = await guard(
        async () => (await navigator.permissions.query({ name: "geolocation" })).state,
      );
      out.evalBlocked = await guard(async () => {
        try {
          (0, eval)("1 + 1");
          return false;
        } catch (error) {
          return error instanceof EvalError;
        }
      });
      out.wasmCompileAllowed = await guard(async () => {
        await WebAssembly.compile(jspiModule);
        return true;
      });
      out.documentCsp = await guard(async () => {
        const response = await fetch(location.href);
        return response.headers.get("content-security-policy");
      });
      return out;
    },
  };
})();
