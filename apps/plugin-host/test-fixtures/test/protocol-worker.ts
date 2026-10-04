/// <reference types="node" />
import { parentPort } from "node:worker_threads";
import type { ToHost, ToPlugin } from "@moxi/sdk/host";

if (!parentPort) throw new Error("This fixture requires a worker");
const port = parentPort;
const post = (message: ToHost) => port.postMessage(message);
let token: string | null = null;
let oldQuery: number | undefined;
let reqId = 0;
let delayedView: Extract<ToPlugin, { t: "command" }> | undefined;
const items = (title: string) => [{ id: title, title, actions: [] }];

port.on("message", (message: ToPlugin) => {
  switch (message.t) {
    case "init":
      post({ t: "subscribe", slice: "player" });
      post({ t: "subscribe", slice: "target" });
      post({ t: "items", items: items("Ready") });
      post({ t: "ready" });
      break;
    case "slice":
      post({
        t: "hud",
        id: message.slice,
        node: { type: "text", text: JSON.stringify(message.value) },
      });
      break;
    case "ping":
      post({ t: "pong", seq: message.seq });
      break;
    case "command":
      if (message.id.startsWith("send:")) port.postMessage(JSON.parse(message.id.slice(5)));
      if (message.id.startsWith("rate:")) {
        for (let i = 0; i < Number(message.id.slice(5)); i++) post({ t: "pong", seq: i });
      }
      if (message.id === "view")
        post({
          t: "view",
          viewId: message.viewId,
          view: { type: "list", title: "Owned view", items: [], filter: "host" },
        });
      if (message.id.startsWith("view-items:"))
        post({
          t: "view",
          viewId: message.viewId,
          view: {
            type: "list",
            title: "Bounded",
            items: Array.from({ length: Number(message.id.slice(11)) }, (_, i) => ({
              id: String(i),
              title: "Item",
              actions: [],
            })),
            filter: "host",
          },
        });
      if (message.id.startsWith("view-nodes:"))
        post({
          t: "view",
          viewId: message.viewId,
          view: {
            type: "detail",
            title: "Bounded",
            blocks: Array.from({ length: Number(message.id.slice(11)) - 1 }, () => ({
              type: "text",
              text: "Block",
            })),
            actions: [],
          },
        });
      if (message.id === "freeze") {
        post({ t: "items", items: items("Hanging") });
        for (;;) {
          /* Deliberately hang this worker. */
        }
      }
      if (message.id === "delayed-view") {
        delayedView = message;
        post({ t: "items", items: items("View pending") });
        return;
      }
      if (message.id === "release-view" && delayedView) {
        post({
          t: "view",
          viewId: delayedView.viewId,
          view: { type: "list", title: "Old view", items: [], filter: "host" },
        });
        post({ t: "commandDone", opId: delayedView.opId });
        delayedView = undefined;
      }
      if (message.id === "doc-read" || message.id === "doc-write")
        post({
          t: "request",
          reqId: ++reqId,
          op: message.id === "doc-read" ? "doc.read" : "doc.write",
          args: { name: "notes", value: { text: "saved" } },
          activation: null,
        });
      if (message.id === "capture") token = message.activation;
      if (message.id === "use")
        post({
          t: "request",
          reqId: ++reqId,
          op: "game.travel",
          args: { mapId: 248 },
          activation: token,
        });
      if (message.id === "clear") post({ t: "items", items: items("Ready") });
      post({ t: "commandDone", opId: message.opId });
      break;
    case "result":
      post({ t: "items", items: items(JSON.stringify(message.value ?? null)) });
      break;
    case "doc":
      post({
        t: "hud",
        id: "document",
        node: { type: "text", text: JSON.stringify(message.value) },
      });
      break;
    case "query":
      if (message.text.startsWith("items:")) {
        post({
          t: "queryResult",
          reqId: message.reqId,
          items: Array.from({ length: Number(message.text.slice(6)) }, (_, i) => ({
            id: String(i),
            title: "Item",
            actions: [],
          })),
        });
      } else if (message.text.startsWith("hold:")) {
        post({ t: "items", items: items(message.text) });
      } else if (message.text === "old") {
        oldQuery = message.reqId;
        post({ t: "items", items: items("Old query received") });
      } else {
        post({ t: "queryResult", reqId: message.reqId, items: items("new") });
        if (oldQuery !== undefined)
          post({ t: "queryResult", reqId: oldQuery, items: items("old") });
      }
      break;
  }
});
