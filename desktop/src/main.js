const { app, BrowserWindow, session, shell, ipcMain, Menu, Tray, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const SERVER_URL = process.env.APP_SERVER_URL || 'https://fullswapbyrich.xyz';

let mainWindow = null;
let splashWindow = null;
let tray = null;

// Window state persistence
function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf8'));
    return { width: saved.width || 1280, height: saved.height || 820, x: saved.x, y: saved.y };
  } catch (_) {
    return { width: 1280, height: 820, x: undefined, y: undefined };
  }
}

function saveWindowState(win) {
  if (!win || win.isMaximized() || win.isMinimized() || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(b));
  } catch (_) {}
}

// Auto-updater
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  autoUpdater.on('update-available', function(info) {
    injectStatusBar('Downloading update v' + info.version + '...');
  });

  autoUpdater.on('download-progress', function(progress) {
    var pct = Math.round(progress.percent);
    if (mainWindow) mainWindow.setProgressBar(progress.percent / 100);
    injectStatusBar('Downloading update... ' + pct + '%');
  });

  autoUpdater.on('update-downloaded', function(info) {
    if (mainWindow) mainWindow.setProgressBar(-1);
    removeStatusBar();
    var rawNotes = '';
    if (typeof info.releaseNotes === 'string') {
      rawNotes = info.releaseNotes.replace(/<[^>]*>/g, '').trim();
    }
    injectUpdateBanner(info.version, rawNotes);
  });

  autoUpdater.on('error', function() {
    if (mainWindow) mainWindow.setProgressBar(-1);
    removeStatusBar();
  });

  ipcMain.on('install-update', function() {
    autoUpdater.quitAndInstall(false, true);
  });

  var checkUpdate = function() { autoUpdater.checkForUpdates().catch(function() {}); };
  setTimeout(checkUpdate, 5000);
  setInterval(checkUpdate, 30 * 60 * 1000);
}

// In-app update banner
function injectUpdateBanner(version, notes) {
  if (!mainWindow) return;
  var whatsNew = notes ? notes.substring(0, 120) : '';
  var noteHtml = whatsNew ? '<span style='color:#94a3b8;font-size:11px;margin-left:8px;'>' + whatsNew + '</span>' : '';
  mainWindow.webContents.executeJavaScript(
    '(function() {' +
    '  if (document.getElementById('__fs-update-banner')) return;' +
    '  var b = document.createElement('div');' +
    '  b.id = '__fs-update-banner';' +
    '  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:linear-gradient(135deg,#0a0f1a 0%,#0d1b2a 100%);border-bottom:1px solid rgba(0,229,255,0.5);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 4px 24px rgba(0,229,255,0.15);';' +
    '  b.innerHTML = '<div style='display:flex;align-items:center;gap:10px;'><span style='display:inline-block;width:8px;height:8px;border-radius:50%;background:#00e5ff;box-shadow:0 0 8px #00e5ff;'></span><span style='color:#e2e8f0;font-size:13px;font-weight:500;'>Full Swap By Rich <strong style='color:#00e5ff;'>v' + version + '</strong> is ready to install</span>' + noteHtml + '</div><div style='display:flex;gap:8px;'><button onclick='window.electronUpdater&&window.electronUpdater.installUpdate()' style='background:#00e5ff;color:#0a0f1a;border:none;padding:7px 18px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;letter-spacing:0.5px;'>Install Now</button><button onclick='this.closest('#__fs-update-banner').remove()' style='background:transparent;color:#64748b;border:1px solid #1e293b;padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer;'>Later</button></div>';' +
    '  document.body.insertBefore(b, document.body.firstChild);' +
    '})()'
  ).catch(function() {});
}

// Download status bar
function injectStatusBar(text) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    '(function() {' +
    '  var bar = document.getElementById('__fs-status-bar');' +
    '  if (!bar) {' +
    '    bar = document.createElement('div');' +
    '    bar.id = '__fs-status-bar';' +
    '    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1a1a2e;border-top:1px solid rgba(0,229,255,0.3);padding:8px 16px;font-family:sans-serif;font-size:12px;color:#ccc;display:flex;align-items:center;gap:8px;';' +
    '    var dot = document.createElement('span');' +
    '    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#00e5ff;display:inline-block;animation:fspulse 1s infinite;';' +
    '    if (!document.getElementById('__fs-keyframes')) {' +
    '      var s = document.createElement('style');s.id='__fs-keyframes';' +
    '      s.textContent='@keyframes fspulse{0%,100%{opacity:1}50%{opacity:0.3}}';' +
    '      document.head.appendChild(s);' +
    '    }' +
    '    bar.appendChild(dot);' +
    '    var t = document.createElement('span');' +
    '    bar.appendChild(t);' +
    '    document.body.appendChild(bar);' +
    '  }' +
    '  bar.lastChild.textContent = ' + JSON.stringify(text) + ';' +
    '})()'
  ).catch(function() {});
}

function removeStatusBar() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    'var b = document.getElementById('__fs-status-bar'); if (b) b.remove();'
  ).catch(function() {});
}

// Permissions
function setupPermissions(win) {
  win.webContents.session.setPermissionRequestHandler(function(_wc, permission, callback) {
    callback(['media', 'camera', 'microphone', 'display-capture'].includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler(function(_wc, permission) {
    return ['media', 'camera', 'microphone', 'display-capture'].includes(permission);
  });
}

// System tray
function setupTray() {
  var iconPath = process.platform === 'win32'
    ? path.join(__dirname, '..', 'build', 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.png');

  try {
    tray = new Tray(iconPath);
  } catch (_) {
    try { tray = new Tray(path.join(__dirname, '..', 'build', 'icon.png')); } catch (_2) { return; }
  }

  tray.setToolTip('Full Swap By Rich');

  var contextMenu = Menu.buildFromTemplate([
    { label: 'Open Full Swap', click: function() { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else { createMainWindow(); } } },
    { type: 'separator' },
    { label: 'Check for Updates', click: function() { autoUpdater.checkForUpdates().catch(function() {}); } },
    { type: 'separator' },
    { label: 'Quit', click: function() { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', function() {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// Splash screen
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420, height: 320,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

// Main window
function createMainWindow() {
  var state = loadWindowState();

  var winOptions = {
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    opacity: 0,
    title: 'Full Swap By Rich',
    backgroundColor: '#0a0f1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
  };

  if (state.x !== undefined && state.y !== undefined) {
    winOptions.x = state.x;
    winOptions.y = state.y;
  }

  // Premium dark title bar
  if (process.platform === 'darwin') {
    winOptions.titleBarStyle = 'hiddenInset';
    winOptions.icon = path.join(__dirname, '..', 'build', 'icon.png');
  } else {
    winOptions.frame = false;
    winOptions.titleBarOverlay = { color: '#0a0f1a', symbolColor: '#00e5ff', height: 36 };
    winOptions.icon = path.join(__dirname, '..', 'build', 'icon.ico');
  }

  mainWindow = new BrowserWindow(winOptions);

  setupPermissions(mainWindow);

  // Force no-cache on every request
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://fullswapbyrich.xyz/*', 'https://*.fullswapbyrich.xyz/*'] },
    function(details, callback) {
      details.requestHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      details.requestHeaders['Pragma'] = 'no-cache';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  mainWindow.webContents.setWindowOpenHandler(function(details) {
    if (!details.url.startsWith(SERVER_URL)) {
      shell.openExternal(details.url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', function() {
    if (splashWindow) { splashWindow.close(); splashWindow = null; }
    // Smooth fade-in
    mainWindow.show();
    var opacity = 0;
    var fadeTimer = setInterval(function() {
      opacity += 0.08;
      if (opacity >= 1) { opacity = 1; clearInterval(fadeTimer); }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(opacity);
    }, 16);
    if (!app.isPackaged) mainWindow.webContents.openDevTools();
  });

  mainWindow.on('close', function(e) {
    saveWindowState(mainWindow);
    // Minimize to tray on Windows instead of closing
    if (process.platform !== 'darwin' && !app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      if (tray && tray.displayBalloon) tray.displayBalloon({
        title: 'Full Swap By Rich',
        content: 'Still running in the system tray. Right-click the tray icon to quit.',
        respectQuietTime: true,
      });
    }
  });

  mainWindow.on('closed', function() { mainWindow = null; });

  mainWindow.webContents.on('did-fail-load', function(_e, code) {
    if (code === -102 || code === -105 || code === -106) {
      setTimeout(function() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(SERVER_URL); }, 3000);
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(path.join(__dirname, 'offline.html'));
    }
  });

  return mainWindow;
}

// App menu
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Full Swap',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: function() { if (mainWindow) mainWindow.reload(); } },
        { label: 'Back', accelerator: 'Alt+Left', click: function() { if (mainWindow) mainWindow.webContents.goBack(); } },
        { type: 'separator' },
        { label: 'Check for Updates', click: function() { autoUpdater.checkForUpdates().catch(function() {}); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: function() { app.isQuiting = true; app.quit(); } },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      ],
    },
  ]));
}

// App lifecycle
app.whenReady().then(async function() {
  // Clear disk cache and service workers on every launch
  await session.defaultSession.clearCache().catch(function() {});
  await session.defaultSession.clearStorageData({
    storages: ['serviceworkers', 'cachestorage'],
  }).catch(function() {});

  createSplash();
  createMainWindow();
  buildMenu();
  setupTray();
  if (app.isPackaged) setupAutoUpdater();

  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('before-quit', function() { app.isQuiting = true; });

app.on('window-all-closed', function() {
  // Don't quit on Windows -- tray keeps the app alive
});
