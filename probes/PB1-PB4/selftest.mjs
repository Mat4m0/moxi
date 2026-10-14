// Node check of the runtime and fixtures before any CI minute is spent (worker_threads stand-in for a Web Worker).
import { Worker } from "node:worker_threads";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildModuleText } = require("./lib/filler.cjs");
const runtime = readFileSync(join(here, "dist/runtime-api1.js"), "utf8");
const dir = mkdtempSync(join(tmpdir(), "pb1-selftest-"));
const adapter = join(dir, "adapter.mjs");
writeFileSync(
  adapter,
  `import { parentPort, workerData } from "node:worker_threads";
globalThis.self = globalThis;
globalThis.postMessage = (m) => parentPort.postMessage(m);
parentPort.on("message", (m) => {
  if (m.t === "__stats") return parentPort.postMessage({ t: "stats", ...globalThis.__moxiBoot.stats() });
  globalThis.onmessage?.({ data: m });
});
(0, eval)(workerData.text);
`,
);

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

function startWorker(plugin) {
  const text = `${runtime}\n__moxiBoot((${plugin}));`;
  const worker = new Worker(adapter, { workerData: { text } });
  const state = { batches: [], opened: [], errors: [], ready: null, stats: null, nodes: new Map() };
  const waiters = [];
  worker.on("message", (m) => {
    if (m.t === "ready") state.ready = m;
    else if (m.t === "opened") state.opened.push(m);
    else if (m.t === "error") state.errors.push(m);
    else if (m.t === "stats") state.stats = m;
    else if (m.t === "ops") {
      state.batches.push(m);
      apply(state.nodes, m.ops);
      worker.postMessage({ t: "ack", sid: m.sid, seq: m.seq });
    }
    for (const w of waiters.splice(0)) w();
  });
  worker.on("error", (e) => state.errors.push({ message: String(e) }));
  state.worker = worker;
  state.until = (pred, ms = 5000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      const tick = () => (pred() ? (clearTimeout(t), resolve()) : waiters.push(tick));
      tick();
    });
  return state;
}

// Minimal applier: enough to check the tree shape.
function apply(nodes, ops) {
  for (let i = 0; i < ops.length; ) {
    switch (ops[i]) {
      case 1: nodes.set(ops[i + 1], { type: ops[i + 2], children: [], props: {}, parent: 0 }); i += 3; break;
      case 2: nodes.set(ops[i + 1], { type: "#text", text: ops[i + 2], children: [], props: {}, parent: 0 }); i += 3; break;
      case 3: {
        const parent = nodes.get(ops[i + 1]); const child = nodes.get(ops[i + 2]);
        if (child.parent) { const old = nodes.get(child.parent); old.children.splice(old.children.indexOf(ops[i + 2]), 1); }
        const at = ops[i + 3] ? parent.children.indexOf(ops[i + 3]) : parent.children.length;
        parent.children.splice(at, 0, ops[i + 2]); child.parent = ops[i + 1]; i += 4; break;
      }
      case 4: { const c = nodes.get(ops[i + 1]); if (c.parent) { const p = nodes.get(c.parent); p.children.splice(p.children.indexOf(ops[i + 1]), 1); } i += 2; break; }
      case 5: nodes.get(ops[i + 1]).props[ops[i + 2]] = ops[i + 3]; i += 4; break;
      case 6: nodes.get(ops[i + 1]).props["@" + ops[i + 2]] = ops[i + 3]; i += 4; break;
      case 7: nodes.get(ops[i + 1]).text = ops[i + 2]; i += 3; break;
      case 8: nodes.get(ops[i + 1]).text = ops[i + 2]; nodes.get(ops[i + 1]).children = []; i += 3; break;
      case 9: {
        const n = nodes.get(ops[i + 1]);
        n.rows = n.rows || new Map();
        for (const row of ops[i + 2]) n.rows.set(row.id, row);
        for (const id of ops[i + 3]) n.rows.delete(id);
        if (ops[i + 4]) n.rows = new Map(ops[i + 4].map((id) => [id, n.rows.get(id)]));
        n.itemOps = (n.itemOps || 0) + 1;
        i += 5; break;
      }
      default: throw new Error(`unknown op ${ops[i]} at ${i}`);
    }
  }
}
const countType = (nodes, type) => [...nodes.values()].filter((n) => n.type === type).length;
const numbers = (batches) => batches.reduce((a, b) => a + b.ops.length, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// (a) Builds-class: collections are data, one ITEMS patch
{
  const s = startWorker(readFileSync(join(here, "dist/plugin-a.js"), "utf8"));
  await s.until(() => s.ready);
  s.worker.postMessage({ t: "open", sid: "a1" });
  await s.until(() => s.opened.length === 1);
  await sleep(100);
  const list = [...s.nodes.values()].find((n) => n.type === "List");
  check("a: one List, no row elements", !!list && countType(s.nodes, "ItemData") === 0 && s.nodes.size <= 3, `nodes=${s.nodes.size}`);
  check("a: 200 rows in one ITEMS patch", list.rows.size === 200 && list.itemOps === 1, `rows=${list.rows.size} itemOps=${list.itemOps}`);
  check("a: previews present", list.rows.get("build-3").preview.length === 3);
  check("a: one batch, no errors", s.batches.length === 1 && s.errors.length === 0, `${s.batches.length} batches, numbers=${numbers(s.batches)}`);
  s.worker.postMessage({ t: "open", sid: "a2" });
  await s.until(() => s.opened.length === 2);
  await sleep(100);
  check("a: second session has own batch", s.batches.some((b) => b.sid === "a2"));
  s.worker.postMessage({ t: "__stats" });
  await s.until(() => s.stats);
  check("a: 200 run handlers + 1 search per session", s.stats.handlers.every((n) => n === 201), JSON.stringify(s.stats));
  await s.worker.terminate();
}
// (b) HUD
{
  const s = startWorker(readFileSync(join(here, "dist/plugin-b.js"), "utf8"));
  await s.until(() => s.ready);
  s.worker.postMessage({ t: "open", sid: "b1" });
  await s.until(() => s.opened.length === 1);
  await sleep(1050);
  const n = s.batches.length;
  check("b: about 10 batches per second", n >= 9 && n <= 13, `got ${n}`);
  const text = [...s.nodes.values()].find((x) => x.type === "HudText");
  check("b: HudText present", !!text);
  s.worker.postMessage({ t: "close", sid: "b1" });
  await sleep(300);
  const after = s.batches.length;
  await sleep(400);
  check("b: timer cleared on close", s.batches.length === after);
  await s.worker.terminate();
}
// (c) Trade-class: a one-row change is 1 ITEMS patch with 1 upsert (DESIGN 0.4, P12)
{
  const s = startWorker(readFileSync(join(here, "dist/plugin-c.js"), "utf8"));
  await s.until(() => s.ready);
  s.worker.postMessage({ t: "open", sid: "c1" });
  await s.until(() => s.opened.length === 1);
  await sleep(100);
  const list = [...s.nodes.values()].find((n) => n.type === "List");
  check("c: 500 rows", list.rows.size === 500);
  const first = s.batches.length;
  await sleep(2100);
  const updates = s.batches.slice(first);
  check("c: about 2 updates per second", updates.length >= 3 && updates.length <= 6, `got ${updates.length}`);
  check("c: each update is 1 ITEMS patch with 1 upsert", updates.every((b) => b.ops.length === 5 && b.ops[0] === 9 && b.ops[2].length === 1 && b.ops[3].length === 0 && b.ops[4] === null), JSON.stringify(updates[0] && updates[0].ops).slice(0, 160));
  await s.worker.terminate();
}
// Diagnostic variants (component per row) still mount.
{
  for (const [file, type, count] of [["plugin-a2.js", "ItemData", 200], ["plugin-c2.js", "TradeRow", 500]]) {
    const s = startWorker(readFileSync(join(here, "dist", file), "utf8"));
    await s.until(() => s.ready);
    s.worker.postMessage({ t: "open", sid: "v" });
    await s.until(() => s.opened.length === 1);
    await sleep(100);
    check(`${file}: ${count} ${type} elements`, countType(s.nodes, type) === count);
    await s.worker.terminate();
  }
}
// Items: removes free signs, reorder is sent only when needed.
{
  const rows = `function plugin(m){const{h,ref,defineComponent}=m.vue;const step=ref(0);setTimeout(()=>{step.value=1},50);setTimeout(()=>{step.value=2},120);
  const mk=(id)=>({id,title:id,actions:[{title:"Run",run:()=>id}]});
  const V=defineComponent({setup(){return()=>h("List",{items:(step.value===0?["a","b","c"]:step.value===1?["a"]:["c","a","b"]).map(mk)})}});return{views:{main:V}}}`;
  const s = startWorker(rows);
  await s.until(() => s.ready);
  s.worker.postMessage({ t: "open", sid: "r1" });
  await s.until(() => s.opened.length === 1);
  await sleep(20);
  s.worker.postMessage({ t: "__stats" });
  await s.until(() => s.stats);
  check("items: 3 handlers at 3 rows", s.stats.handlers[0] === 3, JSON.stringify(s.stats));
  s.stats = null;
  await sleep(60);
  s.worker.postMessage({ t: "__stats" });
  await s.until(() => s.stats);
  const removal = s.batches.find((b) => b.ops[0] === 9 && b.ops[3].length === 2);
  check("items: removal is one patch with 2 removes, no upserts, no order", !!removal && removal.ops[2].length === 0 && removal.ops[4] === null);
  check("items: signs freed for removed rows", s.stats.handlers[0] === 1, JSON.stringify(s.stats));
  s.stats = null;
  await sleep(100);
  const back = s.batches[s.batches.length - 1];
  check("items: re-adding in another order sends the order", back.ops[0] === 9 && back.ops[4] && back.ops[4].join() === "c,a,b", JSON.stringify(back.ops).slice(0, 200));
  await s.worker.terminate();
}
// Handler signs are freed when rows go away (no leak on remove).
{
  const churn = `function plugin(m){const{h,ref,defineComponent}=m.vue;const n=ref(3);setTimeout(()=>{n.value=1},50);setTimeout(()=>{n.value=3},120);
  const V=defineComponent({setup(){return()=>h("List",null,Array.from({length:n.value},(_, i)=>h("ItemData",{key:i,id:"x"+i,onSelect:()=>i},[h("Preview",{onHover:()=>i},"p")])))}});return{views:{main:V}}}`;
  const s = startWorker(churn);
  await s.until(() => s.ready);
  s.worker.postMessage({ t: "open", sid: "t1" });
  await s.until(() => s.opened.length === 1);
  await sleep(30);
  s.worker.postMessage({ t: "__stats" });
  await s.until(() => s.stats);
  check("churn: 6 handlers at 3 rows", s.stats.handlers[0] === 6, JSON.stringify(s.stats));
  s.stats = null;
  await sleep(80);
  s.worker.postMessage({ t: "__stats" });
  await s.until(() => s.stats);
  check("churn: 2 handlers at 1 row (signs freed)", s.stats.handlers[0] === 2, JSON.stringify(s.stats));
  await s.worker.terminate();
}
// Filler: exact sizes and evaluates in a worker.
{
  for (const mib of [0.5, 2]) {
    const bytes = Math.round(mib * 1048576);
    const text = buildModuleText(runtime, bytes);
    check(`filler ${mib} MiB exact`, text.length === bytes);
    const worker = new Worker(adapter, { workerData: { text } });
    const msg = await new Promise((resolve) => worker.once("message", resolve));
    check(`filler ${mib} MiB evaluates`, msg.t === "ready");
    worker.postMessage({ t: "open", sid: "f" });
    const opened = await new Promise((resolve) => worker.once("message", resolve));
    check(`filler ${mib} MiB factory runs`, opened.t === "opened", `${opened.ms?.toFixed(1)} ms`);
    await worker.terminate();
  }
}
console.log(failures.length ? `FAILED: ${failures.join(", ")}` : "selftest passed");
process.exit(failures.length ? 1 : 0);
