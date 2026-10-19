// Mode screen bridge: run the pharmacy on this computer, or connect to the computer that runs it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pcrmMode", {
  info: () => ipcRenderer.invoke("mode:info"),
  runHere: () => ipcRenderer.invoke("mode:server"),
  connect: (address) => ipcRenderer.invoke("mode:connect", String(address ?? "")),
});
