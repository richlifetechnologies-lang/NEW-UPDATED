const { app, BrowserWindow, session, shell, ipcMain, Menu } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

// ── Server URL ────────────────────────────────────────────────────────────────
// In production this points at your hosted server.
// Set the APP_SERVER_URL env var at build time via GitHub Actions, or change
// the fallback URL below to your live domain.
const SERVER_URL = process.env.APP_SERVER_URL || "https://your-domain.com";

let mainWindow = null;
let splashWindow = null;

// ── Auto-updater (checks GitHub Releases) ────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", info.version);
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });

  ipcMain.on("install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.on("download-update", () => {
    autoUpdater.downloadUpdate();
  });

  // Check for updates 5 seconds after launch (non-blocking)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5_000);
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

  // Open external links in system browser, not inside the app
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
app.whenReady().then(() => {
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
