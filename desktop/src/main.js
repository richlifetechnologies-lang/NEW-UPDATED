const { app, BrowserWindow, session, shell, ipcMain, Menu, Tray, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const SERVER_URL = process.env.APP_SERVER_URL || 'https://fullswapbyrich.xyz';

let mainWindow = null;
let splashWindow = null;
let tray = null;

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

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  autoUpdater.on('update-available', function(info) {
    injectStatusBar('Downloading update v' + info.version + '...', 0);
  });

  autoUpdater.on('download-progress', function(progress) {
    var pct = Math.round(progress.percent);
    if (mainWindow) mainWindow.setProgressBar(progress.percent / 100);
    injectStatusBar('Downloading update v' + progress.version + '...', pct);
  });

  autoUpdater.on('update-downloaded', function(info) {
    if (mainWindow) mainWindow.setProgressBar(-1);
    removeStatusBar();
    var rawNotes = '';
    if (typeof info.releaseNotes === 'string') {
      rawNotes = info.releaseNotes;
    } else if (Array.isArray(info.releaseNotes)) {
      rawNotes = info.releaseNotes.map(function(r) { return r.note || r; }).join(' ');
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

function injectUpdateBanner(version, rawNotes) {
  if (!mainWindow) return;

  // Parse bullet points from markdown or plain text release notes
  var bullets = [];
  if (rawNotes) {
    var clean = rawNotes.replace(/<[^>]*>/g, '').trim();
    var lines = clean.split(/
/).map(function(l) { return l.replace(/^[-*•]+s*/, '').trim(); }).filter(function(l) { return l.length > 3 && l.length < 120; });
    bullets = lines.slice(0, 4);
  }

  var bulletHtml = '';
  if (bullets.length > 0) {
    bulletHtml = bullets.map(function(b) {
      return '<div style='display:flex;align-items:flex-start;gap:7px;margin-top:5px;'>' +
        '<span style='margin-top:5px;width:4px;height:4px;border-radius:50%;background:#00e5ff;flex-shrink:0;display:inline-block;'></span>' +
        '<span style='font-size:12px;color:#94a3b8;line-height:1.5;'>' + b.substring(0, 100) + '</span>' +
        '</div>';
    }).join('');
  }

  var whatsNewSection = bulletHtml
    ? '<div style='margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);'>' +
      '<div style='font-size:10px;font-weight:700;letter-spacing:1.2px;color:#475569;text-transform:uppercase;margin-bottom:2px;'>What's new</div>' +
      bulletHtml + '</div>'
    : '';

  mainWindow.webContents.executeJavaScript(
    '(function() {' +
    '  if (document.getElementById('__fs-update-banner')) return;' +
    '  var overlay = document.createElement('div');' +
    '  overlay.id = '__fs-update-banner';' +
    '  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:fsOverlayIn 0.3s ease;';' +
    '  if (!document.getElementById('__fs-anim')) {' +
    '    var st = document.createElement('style');' +
    '    st.id='__fs-anim';' +
    '    st.textContent='@keyframes fsOverlayIn{from{opacity:0}to{opacity:1}}@keyframes fsCardIn{from{opacity:0;transform:scale(0.94) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes fsSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}@keyframes fsGlow{0%,100%{opacity:0.6}50%{opacity:1}}';' +
    '    document.head.appendChild(st);' +
    '  }' +
    '  var card = document.createElement('div');' +
    '  card.style.cssText = 'background:linear-gradient(160deg,#0d1b2a 0%,#0a0f1a 60%,#0d1b2a 100%);border:1px solid rgba(0,229,255,0.2);border-radius:18px;padding:28px 28px 24px;width:380px;max-width:90vw;box-shadow:0 32px 80px rgba(0,0,0,0.7),0 0 60px rgba(0,229,255,0.06),inset 0 1px 0 rgba(255,255,255,0.06);animation:fsCardIn 0.35s cubic-bezier(0.34,1.56,0.64,1);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;position:relative;overflow:hidden;';' +
    '  card.innerHTML = '<div style='position:absolute;top:-40px;right:-40px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(0,229,255,0.06) 0%,transparent 70%);pointer-events:none;'></div>' +' +
    '    '<div style='display:flex;align-items:center;gap:12px;margin-bottom:6px;'>' +
    '      <div style='width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#00e5ff22,#0098b322);border:1px solid rgba(0,229,255,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;'>' +
    '        <svg width='18' height='18' viewBox='0 0 24 24' fill='none'><path d='M12 2L13.5 8.5H20L14.5 12.5L16.5 19L12 15L7.5 19L9.5 12.5L4 8.5H10.5L12 2Z' fill='#00e5ff'/></svg>' +
    '      </div>' +
    '      <div><div style='font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#00e5ff;margin-bottom:2px;'>Update Ready</div>' +
    '        <div style='font-size:18px;font-weight:700;color:#f1f5f9;'>Full Swap By Rich <span style='color:#00e5ff;'>v' + version + '</span></div></div>' +' +
    '    '</div>' +' +
    '    '<div style='font-size:13px;color:#64748b;margin-bottom:4px;'>A new version has downloaded and is ready to install.</div>' +' +
    (whatsNewSection ? ''<div id=__fs-wnotes>' + ' + JSON.stringify(whatsNewSection) + ' + '</div>' +' : '') +
    '    '<div style='display:flex;gap:10px;margin-top:20px;'>' +
    '      <button id='__fs-install-btn' style='flex:1;background:linear-gradient(135deg,#00e5ff,#0098b3);color:#0a0f1a;border:none;padding:12px 0;border-radius:10px;font-weight:800;font-size:14px;cursor:pointer;letter-spacing:0.3px;box-shadow:0 4px 20px rgba(0,229,255,0.35);transition:all 0.2s ease;' onmouseover='this.style.transform=\"scale(1.03)\";this.style.boxShadow=\"0 6px 28px rgba(0,229,255,0.5)\"' onmouseout='this.style.transform='';this.style.boxShadow=\"0 4px 20px rgba(0,229,255,0.35)\"'>Restart &amp; Install</button>' +
    '      <button onclick='document.getElementById(\"__fs-update-banner\").remove()' style='padding:12px 18px;background:transparent;color:#475569;border:1px solid #1e293b;border-radius:10px;font-size:13px;cursor:pointer;transition:all 0.2s ease;' onmouseover='this.style.borderColor=\"#334155\";this.style.color=\"#94a3b8\"' onmouseout='this.style.borderColor=\"#1e293b\";this.style.color=\"#475569''>Later</button>' +
    '    </div>';' +
    '  document.getElementById('__fs-install-btn').addEventListener('click', function() {' +
    '    window.electronUpdater && window.electronUpdater.installUpdate();' +
    '  });' +
    '  overlay.appendChild(card);' +
    '  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });' +
    '  document.body.appendChild(overlay);' +
    '})()'
  ).catch(function() {});
}

function injectStatusBar(text, pct) {
  if (!mainWindow) return;
  var safePct = Math.min(100, Math.max(0, pct || 0));
  mainWindow.webContents.executeJavaScript(
    '(function() {' +
    '  var bar = document.getElementById('__fs-status-bar');' +
    '  if (!bar) {' +
    '    bar = document.createElement('div');' +
    '    bar.id = '__fs-status-bar';' +
    '    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999998;background:#0a0f1a;border-bottom:1px solid rgba(0,229,255,0.2);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;overflow:hidden;';' +
    '    var fill = document.createElement('div');' +
    '    fill.id = '__fs-status-fill';' +
    '    fill.style.cssText = 'position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,rgba(0,229,255,0.08),rgba(0,229,255,0.04));transition:width 0.4s ease;width:0%;';' +
    '    var inner = document.createElement('div');' +
    '    inner.style.cssText = 'position:relative;padding:9px 20px;display:flex;align-items:center;gap:10px;';' +
    '    var dot = document.createElement('span');' +
    '    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#00e5ff;display:inline-block;flex-shrink:0;animation:fspulse 1s infinite;';' +
    '    if (!document.getElementById('__fs-keyframes')) {' +
    '      var s = document.createElement('style');s.id='__fs-keyframes';' +
    '      s.textContent='@keyframes fspulse{0%,100%{opacity:1}50%{opacity:0.3}}';' +
    '      document.head.appendChild(s);' +
    '    }' +
    '    var txt = document.createElement('span');' +
    '    txt.id = '__fs-status-txt';' +
    '    txt.style.cssText = 'font-size:12px;color:#94a3b8;';' +
    '    var pctSpan = document.createElement('span');' +
    '    pctSpan.id = '__fs-status-pct';' +
    '    pctSpan.style.cssText = 'font-size:12px;color:#00e5ff;font-weight:600;margin-left:auto;';' +
    '    var track = document.createElement('div');' +
    '    track.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:2px;background:rgba(255,255,255,0.04);';' +
    '    var prog = document.createElement('div');' +
    '    prog.id = '__fs-status-prog';' +
    '    prog.style.cssText = 'height:100%;background:linear-gradient(90deg,#00e5ff,#0098b3);transition:width 0.4s ease;width:0%;';' +
    '    track.appendChild(prog);' +
    '    inner.appendChild(dot);inner.appendChild(txt);inner.appendChild(pctSpan);' +
    '    bar.appendChild(fill);bar.appendChild(inner);bar.appendChild(track);' +
    '    document.body.insertBefore(bar, document.body.firstChild);' +
    '  }' +
    '  var p = ' + safePct + ';' +
    '  var fillEl = document.getElementById('__fs-status-fill');' +
    '  if (fillEl) fillEl.style.width = p + '%';' +
    '  var progEl = document.getElementById('__fs-status-prog');' +
    '  if (progEl) progEl.style.width = p + '%';' +
    '  var txtEl = document.getElementById('__fs-status-txt');' +
    '  if (txtEl) txtEl.textContent = ' + JSON.stringify(text) + ';' +
    '  var pctEl = document.getElementById('__fs-status-pct');' +
    '  if (pctEl) pctEl.textContent = p > 0 ? p + '%' : '';' +
    '})()'
  ).catch(function() {});
}

function removeStatusBar() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    'var b = document.getElementById('__fs-status-bar'); if (b) b.remove();'
  ).catch(function() {});
}

function injectConnectionRestoredToast() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    '(function() {' +
    '  var t = document.createElement('div');' +
    '  t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);z-index:999999;background:linear-gradient(135deg,#0a2a1a,#0d3322);border:1px solid rgba(34,197,94,0.5);border-radius:10px;padding:10px 20px;display:flex;align-items:center;gap:10px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:13px;color:#e2e8f0;box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 20px rgba(34,197,94,0.1);opacity:0;transition:opacity 0.3s ease,transform 0.3s ease;pointer-events:none;';' +
    '  t.innerHTML = '<span style='display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;'></span><span><strong style='color:#22c55e;'>Connection restored</strong> &mdash; you&rsquo;re back online</span>';' +
    '  document.body.appendChild(t);' +
    '  requestAnimationFrame(function() { t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)'; });' +
    '  setTimeout(function() { t.style.opacity='0';t.style.transform='translateX(-50%) translateY(20px)';setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},350); }, 4000);' +
    '})()'
  ).catch(function() {});
}

function setupPermissions(win) {
  win.webContents.session.setPermissionRequestHandler(function(_wc, permission, callback) {
    callback(['media', 'camera', 'microphone', 'display-capture'].includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler(function(_wc, permission) {
    return ['media', 'camera', 'microphone', 'display-capture'].includes(permission);
  });
}

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
  tray.on('double-click', function() { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420, height: 320,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function createMainWindow() {
  var state = loadWindowState();
  var wasOffline = false;
  var winOptions = {
    width: state.width, height: state.height,
    minWidth: 960, minHeight: 600,
    show: false, opacity: 0,
    title: 'Full Swap By Rich',
    backgroundColor: '#0a0f1a',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'), webSecurity: true,
    },
  };
  if (state.x !== undefined && state.y !== undefined) { winOptions.x = state.x; winOptions.y = state.y; }
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
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://fullswapbyrich.xyz/*', 'https://*.fullswapbyrich.xyz/*'] },
    function(details, callback) {
      details.requestHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      details.requestHeaders['Pragma'] = 'no-cache';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
  mainWindow.webContents.setWindowOpenHandler(function(details) {
    if (!details.url.startsWith(SERVER_URL)) { shell.openExternal(details.url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  mainWindow.loadURL(SERVER_URL);
  mainWindow.once('ready-to-show', function() {
    if (splashWindow) { splashWindow.close(); splashWindow = null; }
    mainWindow.show();
    var opacity = 0;
    var fadeTimer = setInterval(function() {
      opacity += 0.08;
      if (opacity >= 1) { opacity = 1; clearInterval(fadeTimer); }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(opacity);
    }, 16);
    if (!app.isPackaged) mainWindow.webContents.openDevTools();
  });
  mainWindow.webContents.on('did-finish-load', function() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    var url = mainWindow.webContents.getURL();
    if (wasOffline && url.startsWith(SERVER_URL)) { wasOffline = false; injectConnectionRestoredToast(); }
  });
  mainWindow.on('close', function(e) {
    saveWindowState(mainWindow);
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
      wasOffline = true;
      setTimeout(function() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(SERVER_URL); }, 3000);
    } else {
      wasOffline = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(path.join(__dirname, 'offline.html'));
    }
  });
  return mainWindow;
}

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

app.whenReady().then(async function() {
  await session.defaultSession.clearCache().catch(function() {});
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }).catch(function() {});
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
app.on('window-all-closed', function() {});
