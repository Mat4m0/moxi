"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("probe", {
  report: (d) => ipcRenderer.send("pb2-host", d),
  event: (d) => ipcRenderer.send("pb2-host-event", d),
  sandboxed: process.sandboxed === true,
});
// MessagePorts and commands reach the main world through window.postMessage (isolated world).
ipcRenderer.on("pb2-port", (e) => window.postMessage({ type: "pb2-port" }, "*", e.ports));
ipcRenderer.on("pb2-cmd", (_e, cmd) => window.postMessage({ type: "pb2-cmd", cmd }, "*"));
