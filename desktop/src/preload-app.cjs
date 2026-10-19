// Desktop controls for the Developer console. Every call is checked in the main process against the
// window's Developer session on the server, so other pages and other users get nothing from it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pcrmDesktop", {
  version: 1,
  status: () => ipcRenderer.invoke("desktop:status"),
  backupNow: () => ipcRenderer.invoke("desktop:backup"),
  chooseMirror: () => ipcRenderer.invoke("desktop:mirror-choose"),
  clearMirror: () => ipcRenderer.invoke("desktop:mirror-clear"),
  pickBackupFile: () => ipcRenderer.invoke("desktop:pick-file"),
  restore: (id, recoveryKey, code) => ipcRenderer.invoke("desktop:restore", { id, recoveryKey: recoveryKey ?? null, code: code ?? "" }),
  openFolder: (which) => ipcRenderer.invoke("desktop:open-folder", which),
  setLan: (enabled) => ipcRenderer.invoke("desktop:lan", Boolean(enabled)),
  onProgress: (fn) => {
    const handler = (_event, text) => fn(String(text));
    ipcRenderer.on("desktop:progress", handler);
    return () => ipcRenderer.removeListener("desktop:progress", handler);
  },
});
