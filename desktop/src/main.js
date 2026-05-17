const { app, BrowserWindow, session, shell, ipcMain, Menu, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

const SERVER_URL = process.env.APP_SERVER_URL || "https://fullswapbyrich.xyz";

let mainWindow = null;
let splashWindow = null;

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", function(info) {
    injectStatusBar("Downloading update v" + info.version + "...");
  });

  autoUpdater.on("download-progress", function(progress) {
    var pct = Math.round(progress.percent);
    if (mainWindow) mainWindow.setProgressBar(progress.percent / 100);
    injectStatusBar("Downloading update... " + pct + "%");
  });

  autoUpdater.on("update-downloaded", function(info) {
    if (mainWindow) mainWindow.setProgressBar(-1);
    removeStatusBar();
    var rawNotes = "";
    if (typeof info.releaseNotes === "string") {
      rawNotes = info.releaseNotes.replace(/<[^>]*>/g, "").trim();
    }
    var whatsNew = rawNotes ? "\n\nWhat's new in v" + info.version + ":\n" + rawNotes : "";
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready to Install",
      message: "Full Swap By Rich v" + info.version + " is ready",
      detail: "The update has finished downloading." + whatsNew + "\n\nClick Install Now to restart and apply it immediately, or Later to install it next time you close the app.",
      buttons: ["Install Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(function(result) {
      if (result.response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  autoUpdater.on("error", function() {
    if (mainWindow) mainWindow.setProgressBar(-1);
    removeStatusBar();
  });

  ipcMain.on("install-update", function() {
    autoUpdater.quitAndInstall(false, true);
  });

  var checkUpdate = function() { autoUpdater.checkForUpdates().catch(function() {}); };
  setTimeout(checkUpdate, 5000);
  setInterval(checkUpdate, 30 * 60 * 1000);
}

// ── Download status bar (bottom of page) ─────────────────────────────────────
function injectStatusBar(text) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    "(function() {" +
    "  var bar = document.getElementById('__fs-status-bar');" +
    "  if (!bar) {" +
    "    bar = document.createElement('div');" +
    "    bar.id = '__fs-status-bar';" +
    "    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;" +
    "      background:#1a1a2e;border-top:1px solid #6c63ff;padding:8px 16px;" +
    "      font-family:sans-serif;font-size:12px;color:#ccc;';" +
    "    document.body.appendChild(bar);" +
    "  }" +
    "  bar.textContent = " + JSON.stringify(text) + ";" +
    "})()"
  ).catch(function() {});
}

function removeStatusBar() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    "var b = document.getElementById('__fs-status-bar'); if (b) b.remove();"
  ).catch(function() {});
}

// ── Permissions ───────────────────────────────────────────────────────────────
function setupPermissions(win) {
  win.webContents.session.setPermissionRequestHandler(function(_wc, permission, callback) {
    callback(["media", "camera", "microphone", "display-capture"].includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler(function(_wc, permission) {
    return ["media", "camera", "microphone", "display-capture"].includes(permission);
  });
}

// ── Splash screen ─────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 400, height: 300,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 600,
    show: false,
    title: "Full Swap By Rich",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: true,
    },
  });

  setupPermissions(mainWindow);

  // Force no-cache on every request to the server so website fixes always show instantly
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["https://fullswapbyrich.xyz/*", "https://*.fullswapbyrich.xyz/*"] },
    function(details, callback) {
      details.requestHeaders["Cache-Control"] = "no-cache, no-store, must-revalidate";
      details.requestHeaders["Pragma"] = "no-cache";
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  mainWindow.webContents.setWindowOpenHandler(function(details) {
    if (!details.url.startsWith(SERVER_URL)) {
      shell.openExternal(details.url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once("ready-to-show", function() {
    if (splashWindow) { splashWindow.close(); splashWindow = null; }
    mainWindow.show();
    mainWindow.focus();
    if (!app.isPackaged) mainWindow.webContents.openDevTools();
  });

  mainWindow.on("closed", function() { mainWindow = null; });

  mainWindow.webContents.on("did-fail-load", function(_e, code, desc) {
    if (code === -102 || code === -105 || code === -106) {
      setTimeout(function() { if (mainWindow) mainWindow.loadURL(SERVER_URL); }, 3000);
    } else {
      if (mainWindow) mainWindow.loadURL(
        "data:text/html,<h2 style=\"font-family:sans-serif;color:#e11;padding:40px\">" +
        "Could not connect to server (" + code + ").<br>" +
        "<small>" + desc + "</small><br><br>" +
        "<button onclick=\"location.reload()\">Retry</button></h2>"
      );
    }
  });

  return mainWindow;
}

// ── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Full Swap",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: function() { if (mainWindow) mainWindow.reload(); } },
        { label: "Back", accelerator: "Alt+Left", click: function() { if (mainWindow) mainWindow.webContents.goBack(); } },
        { type: "separator" },
        { label: "Check for Updates", click: function() { autoUpdater.checkForUpdates().catch(function() {}); } },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" },
      ],
    },
  ]));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async function() {
  // Clear disk cache and service workers on every launch as extra insurance
  await session.defaultSession.clearCache().catch(function() {});
  await session.defaultSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage"],
  }).catch(function() {});

  createSplash();
  createMainWindow();
  buildMenu();
  if (app.isPackaged) setupAutoUpdater();

  app.on("activate", function() {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", function() {
  if (process.platform !== "darwin") app.quit();
});
