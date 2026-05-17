const { contextBridge, ipcRenderer } = require('electron');

// Unified API exposed to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Auto-updater
  installUpdate: () => ipcRenderer.send('install-update'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),

  // First-launch
  markLaunched: () => ipcRenderer.send('mark-launched'),

  // Dark/light mode
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
});

// Legacy aliases (kept for backward compatibility)
contextBridge.exposeInMainWorld('electronUpdater', {
  installUpdate: () => ipcRenderer.send('install-update'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
});

// Electron detection flag
contextBridge.exposeInMainWorld('isElectron', true);

// Window controls for custom title bar
contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: (cb) => ipcRenderer.on('window-maximized-state', (_e, state) => cb(state)),
});
