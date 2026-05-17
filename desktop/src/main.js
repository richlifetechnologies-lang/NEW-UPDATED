const { app, BrowserWindow, session, shell, ipcMain, Menu, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

// ── Server URL ────────────────────────────────────────────────────────────────
// Priority order:
//   1. APP_SERVER_URL env var — set in GitHub → Settings → Variables → Actions
//      (change it there and rebuild to switch domains without touching code)
//   2. Hardcoded fallback below — update this when your primary domain changes
//
// To revert to a previous URL:
//   Option A (no rebuild): change APP_SERVER_URL in GitHub repo variables, re-run
//                          the "Build Desktop App" workflow
//   Option B (permanent):  update the fallback string below and push to GitHub
const SERVER_URL = process.env.APP_SERVER_URL || "https://fullswapbyrich.xyz";

let mainWindow = null;
let splashWindow = null;
let pendingUpdateVersion = null;

// ── Update notification overlay (injected into the page) ──────────────────────
// Shows a dismiss-able banner in the top-right corner without touching the server code.
const UPDATE_BANNER_CSS = `
  #__fs-update-banner {
    position: fixed; top: 12px; right: 16px; z-index: 99999;
    background: #1a1a2e; color: #fff; border: 1px solid #6c63ff;
    border-radius: 10px; padding: 10px 16px; font-family: sans-serif;
    font-size: 13px; display: flex; align-items: center; gap: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,.5); max-width: 320px;
  }
  #__fs-update-banner button {
    border: none; border-radius: 6px; cursor: pointer; font-size: 12px; padding: 5px 10px;
  }
  #__fs-update-banner .install-btn { background: #6c63ff; color: #fff; }
  #__fs-update-banner .dismiss-btn { background: transparent; color: #aaa; }
`;

// ── Auto-updater (checks GitHub Releases) ────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", (info) => {
    injectStatusBar(`⬇ Downloading update v${info.version}…`);
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent);
    mainWindow?.setProgressBar(progress.percent / 100);
    injectStatusBar(`⬇ Downloading update… ${pct}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.setProgressBar(-1);
    removeStatusBar();
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready to Install",
      message: `Full Swap By Rich v${info.version} is ready`,
      detail: "The update has finished downloading.\n\nClick \"Install Now\" to restart and apply it immediately, or \"Later\" to install it next time you close the app.",
      buttons: ["Install Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  autoUpdater.on("error", () => {
    mainWindow?.setProgressBar(-1);
    removeStatusBar();
  });

  ipcMain.on("install-update", () => autoUpdater.quitAndInstall(false, true));

  const checkUpdate = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(checkUpdate, 5_000);
  setInterval(checkUpdate, 30 * 60 * 1_000);
}

function injectStatusBar(text) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(`
    (function() {
      let bar = document.getElementById('__fs-status-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = '__fs-status-bar';
        bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1a1a2e;border-top:1px solid #6c63ff;padding:8px 16px;font-family:sans-serif;font-size:12px;color:#ccc;';
        document.body.appendChild(bar);
      }
      bar.textContent = \`${text}\`;
    })();
  `).catch(() => {});
}

function removeStatusBar() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(`
    const b = document.getElementById('__fs-status-bar'); if (b) b.remove();
  `).catch(() => {});
}
  // Check on launch, then every 30 minutes
  const checkUpdate = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(checkUpdate, 5_000);
  setInterval(checkUpdate, 30 * 60 * 1_000);
}

// ── Permissions — allow camera + microphone ───────────────────────────────────
function setupPermissions(win) {
  win.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowed = ["media", "camera", "microphone", "display-capture"];
      callback(allowed.includes(permission));
    }
  );

  win.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => {
      const allowed = ["media", "camera", "microphone", "display-capture"];
      return allowed.includes(permission);
    }
  );
}

// ── Splash screen ─────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
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

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SERVER_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once("ready-to-show", () => {
    splashWindow?.close();
    splashWindow = null;
    mainWindow.show();
    mainWindow.focus();
    if (!app.isPackaged) mainWindow.webContents.openDevTools();
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  // Auto-reload on focus so any server-side changes are reflected immediately.
  // Guard: skip reload if a file-input dialog was recently open (Electron fires
  // focus when the OS file picker closes, which would wipe uploaded file state).
  let lastBlurMs = 0;
  mainWindow.on("blur", () => { lastBlurMs = Date.now(); });
  mainWindow.on("focus", () => {
    const msSinceBlur = Date.now() - lastBlurMs;
    // If focus returned within 3 seconds, it was likely a file picker — skip reload
    if (msSinceBlur < 3000) return;
    mainWindow?.webContents.reloadIgnoringCache();
  });

  // Retry if the server is temporarily unavailable
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code === -102 || code === -105 || code === -106) {
      setTimeout(() => mainWindow?.loadURL(SERVER_URL), 3000);
    } else {
      mainWindow?.loadURL(
        `data:text/html,<h2 style="font-family:sans-serif;color:#e11;padding:40px">
          Could not connect to server (${code}).<br>
          <small>${desc}</small><br><br>
          <button onclick="location.reload()">Retry</button>
        </h2>`
      );
    }
  });

  return mainWindow;
}

// ── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: "Full Swap",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        { label: "Back", accelerator: "Alt+Left", click: () => mainWindow?.webContents.goBack() },
        { type: "separator" },
        { label: "Check for Updates", click: () => autoUpdater.checkForUpdates().catch(() => {}) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Clear cache + service workers on every launch so web fixes always reach users
  await session.defaultSession.clearCache().catch(() => {});
  await session.defaultSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage"],
  }).catch(() => {});
  createSplash();
  createMainWindow();
  buildMenu();
  if (app.isPackaged) setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
