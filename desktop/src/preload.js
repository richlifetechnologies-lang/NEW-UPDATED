const { contextBridge, ipcRenderer } = require('electron');

// Expose safe auto-updater API to the renderer
contextBridge.exposeInMainWorld('electronUpdater', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, version) => cb(version)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', cb),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
});

// Expose Electron flag so the web app can detect it's running in the desktop
contextBridge.exposeInMainWorld('isElectron', true);

// Expose window controls for custom title bar
contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: (cb) => ipcRenderer.on('window-maximized-state', (_e, state) => cb(state)),
});
