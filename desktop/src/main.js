const { app, BrowserWindow, session, shell, ipcMain, Menu, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

const SERVER_URL = process.env.APP_SERVER_URL || "https://fullswapbyrich.xyz";

let mainWindow = null;
let splashWindow = null;

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", (info) => {
    injectStatusBar(`Downloading update v${info.version}...`);
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent);
    mainWindow?.setProgressBar(progress.percent / 100);
    injectStatusBar(`Downloading update... ${pct}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.setProgressBar(-1);
    removeStatusBar();
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready to Install",
      message: `Full Swap By Rich v${info.version} is ready`,
      detail: "The update has finished downloading.\n\nClick Install Now to restart and apply it immediately, or Later to install it next time you close the app.",
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
  setTimeout(checkUpdate, 5000);
  setInterval(checkUpdate, 30 * 60 * 1000);
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
      bar.textContent = "${text}";
    })();
  `).catch(() => {});
}

function removeStatusBar() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    "const b = document.getElementById('__fs-status-bar'); if (b) b.remove();"
  ).catch(() => {});
}

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
    splashWindow =
