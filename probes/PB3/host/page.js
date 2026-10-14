// PB3 host page: starts the attempt worker and a sibling worker the way moxi's plugin host
// does (data: module workers), and runs attempts when Main asks through executeJavaScript.
import { makeAttempts } from "./attempts.js";

const pageOnly = new Set(["img", "iframe", "linkPreconnect"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dataModule = (source) => `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;

function attemptWorkerMain(makeAttempts) {
  let lib;
  onmessage = async (event) => {
    const message = event.data;
    if (message.init) {
      lib = makeAttempts(message.env);
      postMessage({ id: message.id, origin: location.origin, names: lib.names });
      return;
    }
    postMessage({ id: message.id, result: await lib.run(message.name) });
  };
}

function siblingMain() {
  const received = [];
  let channel = "listening";
  try {
    new BroadcastChannel("pb3").onmessage = (event) => received.push(String(event.data));
  } catch (error) {
    channel = `threw ${error?.name}`;
  }
  onmessage = async (event) => {
    let locks;
    try {
      locks = (await navigator.locks.query()).held.map((lock) => lock.name);
    } catch (error) {
      locks = `threw ${error?.name}`;
    }
    postMessage({ id: event.data.id, origin: location.origin, channel, received: received.slice(), locks });
  };
}

let page;
let attemptWorker;
let sibling;
let sequence = 0;

function call(worker, message, ms) {
  if (!worker) return Promise.resolve({ error: "worker not started" });
  const id = ++sequence;
  return Promise.race([
    new Promise((resolve) => {
      const listener = (event) => {
        if (event.data?.id !== id) return;
        worker.removeEventListener("message", listener);
        resolve(event.data);
      };
      worker.addEventListener("message", listener);
      worker.postMessage({ ...message, id });
    }),
    sleep(ms).then(() => ({ error: `no answer after ${ms} ms` })),
  ]);
}

function startWorker(source) {
  try {
    const worker = new Worker(dataModule(source), { type: "module", name: "pb3" });
    const errors = [];
    worker.addEventListener("error", (event) => errors.push(event.message || "error event"));
    return { worker, errors };
  } catch (error) {
    return { worker: undefined, errors: [`constructor threw ${error?.name}: ${error?.message}`] };
  }
}

async function nestedTerminate() {
  const parentSource = `
    const channel = new MessageChannel();
    try {
      const child = new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(
        "onmessage = (e) => { const port = e.data; setInterval(() => port.postMessage(1), 50); }"));
      child.postMessage(channel.port1, [channel.port1]);
      postMessage({ created: true, port: channel.port2 }, [channel.port2]);
    } catch (error) {
      postMessage({ created: false, error: String(error) });
    }`;
  const { worker: parent, errors } = startWorker(parentSource);
  if (!parent) return { outcome: "threw", detail: errors.join("; ") };
  const report = await Promise.race([
    new Promise((resolve) => (parent.onmessage = (event) => resolve(event.data))),
    sleep(3000).then(() => ({ created: false, error: `parent silent; ${errors.join("; ")}` })),
  ]);
  if (!report.created) {
    parent.terminate();
    return { outcome: "threw", detail: report.error };
  }
  let ticks = 0;
  report.port.onmessage = () => ticks++;
  await sleep(600);
  const before = ticks;
  parent.terminate();
  await sleep(300);
  ticks = 0;
  await sleep(1000);
  return {
    outcome: "succeeded",
    detail: `child created; ticks in 600 ms before parent.terminate ${before}; ticks in 1000 ms after ${ticks}`,
    childTicksBefore: before,
    childTicksAfter: ticks,
  };
}

window.pb3 = {
  async start(env) {
    page = makeAttempts({ ...env, tag: `${env.config}/page` });
    const attempt = startWorker(`const makeAttempts = ${makeAttempts};\n(${attemptWorkerMain})(makeAttempts);`);
    const siblingStart = startWorker(`(${siblingMain})();`);
    attemptWorker = attempt.worker;
    sibling = siblingStart.worker;
    const ready = await call(attemptWorker, { init: true, env: { ...env, tag: `${env.config}/worker` } }, 5000);
    const siblingReady = await call(sibling, {}, 5000);
    return {
      pageOrigin: location.origin,
      worker: ready.error ? `not started: ${ready.error}; ${attempt.errors.join("; ")}` : `origin ${ready.origin}`,
      sibling: siblingReady.error
        ? `not started: ${siblingReady.error}; ${siblingStart.errors.join("; ")}`
        : `origin ${siblingReady.origin}; channel ${siblingReady.channel}`,
    };
  },
  names(context) {
    if (context === "page") return page.names.filter((name) => name !== "preludeDeletesWorker");
    const shared = page.names.filter((name) => !pageOnly.has(name) && name !== "preludeDeletesWorker");
    return [...shared, "nestedTerminate", "preludeDeletesWorker"];
  },
  async run(context, name) {
    let result;
    if (name === "nestedTerminate") result = await nestedTerminate();
    else if (context === "page") result = await page.run(name);
    else {
      const answer = await call(attemptWorker, { name }, 15000);
      result = answer.result ?? { outcome: "workerUnavailable", detail: answer.error };
    }
    if (name === "broadcastChannel" || name === "locks") {
      const seen = await call(sibling, {}, 3000);
      result.sibling = seen.error ?? { received: seen.received, locks: seen.locks };
    }
    return result;
  },
};
