// First-start screen bridge: the page can only ask for these actions; the main process decides what they do.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pcrmSetup", {
  options: () => ipcRenderer.invoke("setup:options"),
  pickFile: () => ipcRenderer.invoke("setup:pick-file"),
  restore: (id, recoveryKey) => ipcRenderer.invoke("setup:restore", id, recoveryKey ?? null),
  startFresh: () => ipcRenderer.invoke("setup:fresh"),
  onProgress: (fn) => ipcRenderer.on("setup:progress", (_event, text) => fn(String(text))),
});
