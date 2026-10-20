const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trackpad", {
  getState: () => ipcRenderer.invoke("state:get"),
  onState: (cb) => ipcRenderer.on("state", (_e, s) => cb(s)),
  onScan: (cb) => ipcRenderer.on("scan", (_e, s) => cb(s)),
});
