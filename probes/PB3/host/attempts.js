// PB3 attempt list. This function is serialized with toString() into the data: worker,
// so it must not reference anything outside its own body.
export function makeAttempts(env) {
  const g = globalThis;
  const tag = env.tag;
  const http = `http://127.0.0.1:${env.ports.http}/${tag}`;
  const tls = `https://127.0.0.1:${env.ports.tls}/${tag}`;
  const quic = `https://127.0.0.1:${env.ports.quic}/${tag}`;
  const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const violations = [];
  try {
    g.addEventListener("securitypolicyviolation", (event) =>
      violations.push(`${event.effectiveDirective} ${event.blockedURI}`),
    );
  } catch {
    // No event target in this context; violations stay unrecorded.
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pending = (ms, what) =>
    sleep(ms).then(() => {
      throw Object.assign(new Error(`${what} still pending after ${ms} ms`), { pb3Pending: true });
    });
  const race = (promise, ms = 2500, what = "operation") => Promise.race([promise, pending(ms, what)]);
  const absent = (name) => ({ outcome: "undefined", detail: `${name} is not defined` });
  const ok = (detail) => ({ outcome: "succeeded", detail });
  const has = (name) => typeof g[name] !== "undefined";

  async function rtc(iceServers) {
    if (!has("RTCPeerConnection")) return absent("RTCPeerConnection");
    const pc = new RTCPeerConnection({ iceServers });
    const types = [];
    pc.onicecandidate = (event) => {
      if (event.candidate) types.push(event.candidate.type ?? "unknown");
    };
    pc.createDataChannel("pb3");
    await pc.setLocalDescription(await pc.createOffer());
    await Promise.race([
      new Promise((resolve) => {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") resolve();
        };
      }),
      sleep(4000),
    ]);
    const state = pc.iceGatheringState;
    pc.close();
    return ok(`constructed; gathering ${state}; candidates ${types.join(",") || "none"}`);
  }

  function workerMessage(worker, ms, what) {
    return race(
      new Promise((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => {
          event.preventDefault?.();
          reject(new Error(`${what} error event: ${event.message || "no message"}`));
        };
      }),
      ms,
      what,
    );
  }

  const attempts = {
    // Network
    fetchHttpLoopback: async () => ok(`status ${(await race(fetch(`${http}/fetchHttpLoopback`))).status}`),
    fetchHttpsLoopback: async () => ok(`status ${(await race(fetch(`${tls}/fetchHttpsLoopback`))).status}`),
    fetchHttpsRemote: async () =>
      ok(`type ${(await race(fetch("https://example.com/", { mode: "no-cors" }), 5000)).type}`),
    fetchMoxiOther: async () => ok(`status ${(await race(fetch("moxi://app/client/Gw.snapshot"))).status}`),
    fetchKeepalive: async () =>
      ok(
        `status ${(await race(fetch(`${http}/fetchKeepalive`, { method: "POST", body: "pb3-leak", keepalive: true }))).status}`,
      ),
    xhr: async () => {
      if (!has("XMLHttpRequest")) return absent("XMLHttpRequest");
      return race(
        new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("POST", `${http}/xhr`);
          request.onload = () => resolve(ok(`status ${request.status}`));
          request.onerror = () => reject(new Error("XHR error event"));
          request.send("pb3-leak");
        }),
      );
    },
    webSocket: async () => {
      if (!has("WebSocket")) return absent("WebSocket");
      return race(
        new Promise((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${env.ports.http}/${tag}/webSocket`);
          socket.onopen = () => {
            socket.send("pb3-leak");
            setTimeout(() => {
              socket.close();
              resolve(ok("opened and sent"));
            }, 100);
          };
          socket.onerror = () => reject(new Error("WebSocket error event"));
        }),
      );
    },
    webSocketStream: async () => {
      if (!has("WebSocketStream")) return absent("WebSocketStream");
      const stream = new WebSocketStream(`ws://127.0.0.1:${env.ports.http}/${tag}/webSocketStream`);
      const { writable } = await race(stream.opened);
      await writable.getWriter().write("pb3-leak");
      stream.close();
      return ok("opened and sent");
    },
    eventSource: async () => {
      if (!has("EventSource")) return absent("EventSource");
      return race(
        new Promise((resolve, reject) => {
          const source = new EventSource(`${http}/eventSource`);
          source.onmessage = () => {
            source.close();
            resolve(ok("message received"));
          };
          source.onerror = () => {
            source.close();
            reject(new Error("EventSource error event"));
          };
        }),
      );
    },
    sendBeacon: async () => {
      if (typeof g.navigator?.sendBeacon !== "function") return absent("navigator.sendBeacon");
      const queued = navigator.sendBeacon(`${http}/sendBeacon`, "pb3-leak");
      await sleep(300);
      return { outcome: queued ? "queued" : "refused", detail: `returned ${queued}` };
    },
    fetchLater: async () => {
      if (!has("fetchLater")) return absent("fetchLater");
      g.fetchLater(`${http}/fetchLater`, { method: "POST", body: "pb3-leak", activateAfter: 0 });
      await sleep(300);
      return { outcome: "queued", detail: "fetchLater returned" };
    },
    webTransport: async () => {
      if (!has("WebTransport")) return absent("WebTransport");
      const transport = new WebTransport(`${quic}/webTransport`);
      transport.closed.catch(() => {});
      await race(transport.ready, 3000, "WebTransport.ready");
      transport.close();
      return ok("ready");
    },
    rtcStunUdp: () => rtc([{ urls: `stun:127.0.0.1:${env.ports.stun}` }]),
    rtcTurnTcp: () =>
      rtc([
        {
          urls: `turn:127.0.0.1:${env.ports.turn}?transport=tcp`,
          username: `pb3-leak-${tag.replaceAll("/", "-")}`,
          credential: "pb3-leak-credential",
        },
      ]),
    // Script loading
    importScriptsHttp: async () => {
      if (typeof g.importScripts !== "function") return absent("importScripts");
      g.importScripts(`${http}/importScriptsHttp.js`);
      return ok("loaded");
    },
    importHttp: async () => ok(`value ${(await race(import(`${http}/importHttp.mjs`))).default}`),
    importHttps: async () => ok(`value ${(await race(import(`${tls}/importHttps.mjs`))).default}`),
    importMoxi: async () =>
      ok(`value ${(await race(import("moxi://app/plugin-host/probe-module.mjs"))).default}`),
    // Workers and channels
    nestedWorkerData: async () => {
      if (!has("Worker")) return absent("Worker");
      const source = `(async () => {
        const out = {};
        try { out.fetch = "succeeded " + (await fetch(${JSON.stringify(`${http}/nestedFetch`)})).status; }
        catch (error) { out.fetch = "threw " + error; }
        try { importScripts(${JSON.stringify(`${http}/nestedImportScripts.js`)}); out.importScripts = "succeeded"; }
        catch (error) { out.importScripts = "threw " + error; }
        postMessage(out);
      })();`;
      const worker = new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
      try {
        return ok(`created; child reported ${JSON.stringify(await workerMessage(worker, 5000, "nested worker"))}`);
      } finally {
        worker.terminate();
      }
    },
    workerBlob: async () => {
      if (!has("Worker")) return absent("Worker");
      const url = URL.createObjectURL(new Blob(["postMessage('alive')"], { type: "text/javascript" }));
      const worker = new Worker(url);
      try {
        return ok(`created; child said ${await workerMessage(worker, 3000, "blob worker")}`);
      } finally {
        worker.terminate();
      }
    },
    sharedWorker: async () => {
      if (!has("SharedWorker")) return absent("SharedWorker");
      const worker = new SharedWorker(
        "data:text/javascript;charset=utf-8,onconnect%3D(e)%3D%3Ee.ports%5B0%5D.postMessage('alive')",
      );
      worker.port.start();
      return race(
        new Promise((resolve, reject) => {
          worker.port.onmessage = (event) => resolve(ok(`child said ${event.data}`));
          worker.onerror = () => reject(new Error("SharedWorker error event"));
        }),
        3000,
        "SharedWorker",
      );
    },
    serviceWorker: async () => {
      const container = g.navigator?.serviceWorker;
      if (!container) return absent("navigator.serviceWorker");
      const registration = await race(container.register("moxi://app/plugin-host/sw.js"), 3000, "register");
      await registration.unregister();
      return ok("registered");
    },
    broadcastChannel: async () => {
      if (!has("BroadcastChannel")) return absent("BroadcastChannel");
      const channel = new BroadcastChannel("pb3");
      channel.postMessage(`marker ${tag}`);
      await sleep(200);
      channel.close();
      return { outcome: "posted", detail: "postMessage returned" };
    },
    // Storage
    indexedDB: async () => {
      if (!has("indexedDB")) return absent("indexedDB");
      return race(
        new Promise((resolve, reject) => {
          const request = indexedDB.open("pb3-probe", 1);
          request.onsuccess = () => {
            request.result.close();
            indexedDB.deleteDatabase("pb3-probe");
            resolve(ok("opened"));
          };
          request.onerror = () => reject(request.error ?? new Error("indexedDB error event"));
        }),
      );
    },
    cacheStorage: async () => {
      if (!has("caches")) return absent("caches");
      await race(g.caches.open("pb3-probe"));
      return ok("opened");
    },
    opfs: async () => {
      if (typeof g.navigator?.storage?.getDirectory !== "function")
        return absent("navigator.storage.getDirectory");
      const root = await race(navigator.storage.getDirectory());
      await race(root.getFileHandle("pb3-probe", { create: true }));
      return ok("file created");
    },
    locks: async () => {
      if (!g.navigator?.locks) return absent("navigator.locks");
      return race(
        new Promise((resolve, reject) => {
          navigator.locks
            .request("pb3-lock", () => {
              resolve(ok("lock granted"));
              return sleep(1500);
            })
            .catch(reject);
        }),
      );
    },
    // Code generation
    eval: async () => ok(`value ${g.eval("40 + 2")}`),
    newFunction: async () => ok(`value ${new Function("return 42")()}`),
    setTimeoutString: async () => {
      g.pb3Timer = 0;
      setTimeout("globalThis.pb3Timer = 42");
      await sleep(300);
      return g.pb3Timer === 42 ? ok("string ran") : { outcome: "noEffect", detail: "string did not run" };
    },
    importData: async () => ok(`value ${(await race(import("data:text/javascript,export default 40 + 2"))).default}`),
    importBlob: async () => {
      const url = URL.createObjectURL(new Blob(["export default 42"], { type: "text/javascript" }));
      return ok(`value ${(await race(import(url))).default}`);
    },
    wasmValidate: async () => ok(`returned ${WebAssembly.validate(wasmBytes)}`),
    wasmCompile: async () => ok(`module ${typeof (await WebAssembly.compile(wasmBytes))}`),
    wasmInstantiate: async () =>
      ok(`instance ${typeof (await WebAssembly.instantiate(wasmBytes)).instance}`),
    wasmModuleSync: async () => ok(`module ${typeof new WebAssembly.Module(wasmBytes)}`),
    wasmCompileStreaming: async () =>
      ok(
        `module ${typeof (await WebAssembly.compileStreaming(
          new Response(wasmBytes, { headers: { "Content-Type": "application/wasm" } }),
        ))}`,
      ),
    // Presence and permissions
    sharedArrayBuffer: async () =>
      has("SharedArrayBuffer")
        ? { outcome: "present", detail: `crossOriginIsolated ${g.crossOriginIsolated}` }
        : absent("SharedArrayBuffer"),
    notification: async () => {
      if (!has("Notification")) return absent("Notification");
      if (typeof Notification.requestPermission !== "function" || !has("document"))
        return { outcome: "present", detail: `permission ${Notification.permission}` };
      return { outcome: "present", detail: `requestPermission ${await race(Notification.requestPermission())}` };
    },
    // Page only (DOM): these stand in for an attacker in the host page's main world.
    img: async () => {
      if (!has("document")) return absent("document");
      return race(
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(ok("load event"));
          image.onerror = () => resolve({ outcome: "errorEvent", detail: "error event" });
          image.src = `${http}/img.png`;
        }),
      );
    },
    iframe: async () => {
      if (!has("document")) return absent("document");
      const frame = document.createElement("iframe");
      frame.src = `${http}/iframe`;
      document.body.append(frame);
      await sleep(1000);
      frame.remove();
      return { outcome: "inserted", detail: "iframe inserted for 1 s" };
    },
    linkPreconnect: async () => {
      if (!has("document")) return absent("document");
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = `https://127.0.0.1:${env.ports.tls}`;
      document.head.append(link);
      await sleep(1000);
      link.remove();
      return { outcome: "inserted", detail: "preconnect link inserted for 1 s" };
    },
  };

  return {
    names: Object.keys(attempts),
    async run(name) {
      violations.length = 0;
      const started = performance.now();
      let result;
      try {
        result = await attempts[name]();
      } catch (error) {
        result = error?.pb3Pending
          ? { outcome: "pending", detail: error.message }
          : { outcome: "threw", detail: `${error?.name}: ${error?.message}`.slice(0, 300) };
      }
      await sleep(50);
      return { ...result, ms: Math.round(performance.now() - started), violations: violations.slice(0, 5) };
    },
  };
}
