"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("probe", {
  emit: (name, payload) => ipcRenderer.send("probe:event", name, payload),
  invoke: (name) => ipcRenderer.invoke("probe:invoke", name),
  on: (name, callback) => {
    ipcRenderer.on(`probe:cmd:${name}`, (_event, payload) => callback(payload));
  },
});
