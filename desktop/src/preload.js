const { contextBridge, ipcRenderer } = require("electron");

// Expose safe auto-updater API to the renderer (web app running in the window)
contextBridge.exposeInMainWorld("electronUpdater", {
  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_e, version) => cb(version)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update-downloaded", cb),
  downloadUpdate: () => ipcRenderer.send("download-update"),
  installUpdate: () => ipcRenderer.send("install-update"),
});

// Expose Electron flag so the web app can detect it's running in the desktop
contextBridge.exposeInMainWorld("isElectron", true);
