"use strict";
// Hands MessagePorts that Main posts on the "port" channel to the page (documented pattern:
// a context-isolated preload re-posts ports with window.postMessage).
const { ipcRenderer } = require("electron");

ipcRenderer.on("port", (event, meta) => {
  window.postMessage({ __probe: "port", meta }, "*", event.ports);
});
