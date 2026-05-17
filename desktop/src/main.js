const { app, BrowserWindow, session, shell, ipcMain, Menu, Tray, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const SERVER_URL = process.env.APP_SERVER_URL || 'https://fullswapbyrich.xyz';

let mainWindow = null;
let splashWindow = null;
let tray = null;

// ─── Window state ─────────────────────────────────────────────────────────────

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
  try { fs.writeFileSync(getWindowStatePath(), JSON.stringify(win.getBounds())); } catch (_) {}
}

// ─── First-launch detection ───────────────────────────────────────────────────

function isFirstLaunch() {
  try {
    fs.readFileSync(path.join(app.getPath('userData'), 'launched-v1.flag'), 'utf8');
    return false;
  } catch (_) {
    return true;
  }
}

function markLaunched() {
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'launched-v1.flag'), '1'); } catch (_) {}
}

// ─── Dark/light mode sync ─────────────────────────────────────────────────────

function getThemeLabel() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

async function applyThemeToSession(ses) {
  var theme = getThemeLabel();
  try {
    await ses.cookies.set({
      url: SERVER_URL, name: 'fs-theme', value: theme,
      path: '/', expirationDate: 9999999999,
    });
  } catch (_) {}
}

function applyThemeToWindow(win) {
  if (!win || win.isDestroyed()) return;
  var theme = getThemeLabel();
  win.webContents.executeJavaScript(
    'document.documentElement.setAttribute("data-fs-theme","' + theme + '");' +
    'document.cookie="fs-theme=' + theme + ';path=/;max-age=31536000";'
  ).catch(function() {});
}

// ─── First-launch welcome screen ──────────────────────────────────────────────

function injectWelcomeScreen() {
  if (!mainWindow) return;

  var js = `(function() {
  if (document.getElementById('__fs-welcome')) return;

  var st = document.createElement('style');
  st.id = '__fs-welcome-styles';
  st.textContent = '@keyframes fsWBg{from{opacity:0}to{opacity:1}}' +
    '@keyframes fsWCard{from{opacity:0;transform:scale(0.92) translateY(18px)}to{opacity:1;transform:scale(1) translateY(0)}}' +
    '@keyframes fsWOrb{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}' +
    '@keyframes fsBtnP{0%,100%{box-shadow:0 0 0 0 rgba(0,229,255,0.4)}70%{box-shadow:0 0 0 10px rgba(0,229,255,0)}}';
  document.head.appendChild(st);

  var overlay = document.createElement('div');
  overlay.id = '__fs-welcome';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999999;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(5,8,16,0.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);animation:fsWBg 0.4s ease;';

  var card = document.createElement('div');
  card.style.cssText = 'position:relative;width:440px;max-width:92vw;' +
    'background:linear-gradient(160deg,#0d1b2a 0%,#080d18 60%,#0a1526 100%);' +
    'border:1px solid rgba(0,229,255,0.18);border-radius:22px;padding:36px 36px 32px;' +
    'box-shadow:0 40px 100px rgba(0,0,0,0.8),0 0 80px rgba(0,229,255,0.07),inset 0 1px 0 rgba(255,255,255,0.07);' +
    'animation:fsWCard 0.45s cubic-bezier(0.34,1.4,0.64,1);' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;overflow:hidden;';

  // Decorative orbs
  var orb1 = document.createElement('div');
  orb1.style.cssText = 'position:absolute;top:-60px;right:-60px;width:240px;height:240px;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(0,229,255,0.09) 0%,transparent 70%);' +
    'animation:fsWOrb 4s ease-in-out infinite;pointer-events:none;';
  var orb2 = document.createElement('div');
  orb2.style.cssText = 'position:absolute;bottom:-80px;left:-60px;width:200px;height:200px;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(0,100,180,0.07) 0%,transparent 70%);pointer-events:none;';
  card.appendChild(orb1);
  card.appendChild(orb2);

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:20px;';
  header.innerHTML =
    '<div style="width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,rgba(0,229,255,0.15),rgba(0,152,179,0.1));border:1px solid rgba(0,229,255,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L14.5 9H22L16 13.5L18.5 21L12 16.5L5.5 21L8 13.5L2 9H9.5L12 2Z" fill="#00e5ff"/></svg>' +
    '</div>' +
    '<div>' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#00e5ff;margin-bottom:3px;">Welcome to</div>' +
      '<div style="font-size:22px;font-weight:800;background:linear-gradient(90deg,#f1f5f9 30%,#00e5ff 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Full Swap By Rich</div>' +
    '</div>';
  card.appendChild(header);

  // Subtitle
  var sub = document.createElement('div');
  sub.style.cssText = 'font-size:14px;color:#64748b;line-height:1.6;margin-bottom:22px;';
  sub.textContent = 'Your premium desktop experience is ready. Here is what is built in for you.';
  card.appendChild(sub);

  // Feature rows
  var features = [
    ['⚡', 'Always fast, always fresh', 'Launches instantly from your system tray — never miss a moment'],
    ['🔒', 'Secure & private', 'Camera and microphone only activate when you allow them'],
    ['🔄', 'Auto-updates silently', 'New features install in the background — always on the latest'],
  ];
  var featureList = document.createElement('div');
  featureList.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:26px;';
  features.forEach(function(f) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:14px;padding:13px 15px;' +
      'background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.055);border-radius:12px;';
    row.innerHTML = '<span style="font-size:18px;flex-shrink:0;margin-top:1px;">' + f[0] + '</span>' +
      '<div><div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:2px;">' + f[1] + '</div>' +
      '<div style="font-size:12px;color:#475569;">' + f[2] + '</div></div>';
    featureList.appendChild(row);
  });
  card.appendChild(featureList);

  // CTA button
  var btn = document.createElement('button');
  btn.id = '__fs-welcome-btn';
  btn.style.cssText = 'width:100%;background:linear-gradient(135deg,#00e5ff,#0098b3);color:#0a0f1a;' +
    'border:none;padding:15px 0;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;' +
    'letter-spacing:0.4px;animation:fsBtnP 2.2s infinite;transition:transform 0.15s ease;';
  btn.textContent = 'Get Started \u2192';
  btn.addEventListener('mouseover', function() { btn.style.transform = 'scale(1.02)'; });
  btn.addEventListener('mouseout', function() { btn.style.transform = ''; });
  btn.addEventListener('click', function() {
    overlay.style.transition = 'opacity 0.35s ease';
    overlay.style.opacity = '0';
    setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 380);
    window.electronAPI && window.electronAPI.markLaunched && window.electronAPI.markLaunched();
  });
  card.appendChild(btn);

  // Fine print
  var fine = document.createElement('div');
  fine.style.cssText = 'text-align:center;margin-top:13px;font-size:11px;color:#1e293b;';
  fine.textContent = 'By continuing you agree to fullswapbyrich.xyz terms';
  card.appendChild(fine);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
})()`;

  mainWindow.webContents.executeJavaScript(js).catch(function() {});
}

// ─── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  var currentVersion = null;
  var isDownloading = false;
  var isUpdateDownloaded = false;

  autoUpdater.on('update-available', function(info) {
    // If the update is already downloaded, re-show the install banner immediately
    // instead of showing the progress bar (which would never complete/hide).
    if (isUpdateDownloaded) {
      var rawNotes = '';
      if (typeof info.releaseNotes === 'string') rawNotes = info.releaseNotes;
      else if (Array.isArray(info.releaseNotes)) rawNotes = info.releaseNotes.map(function(r) { return r.note || r; }).join(' ');
      injectUpdateBanner(info.version, rawNotes);
      return;
    }
    if (isDownloading) return;
    isDownloading = true;
    currentVersion = info.version;
    injectStatusBar('Downloading update v' + info.version + '...', 0);
  });

  autoUpdater.on('download-progress', function(progress) {
    var pct = Math.round(progress.percent);
    if (mainWindow) mainWindow.setProgressBar(progress.percent / 100);
    injectStatusBar('Downloading update v' + (currentVersion || '') + '...', pct);
  });

  autoUpdater.on('update-downloaded', function(info) {
    isDownloading = false;
    isUpdateDownloaded = true;
    currentVersion = null;
    if (mainWindow) mainWindow.setProgressBar(-1);
    removeStatusBar();
    var rawNotes = '';
    if (typeof info.releaseNotes === 'string') rawNotes = info.releaseNotes;
    else if (Array.isArray(info.releaseNotes)) rawNotes = info.releaseNotes.map(function(r) { return r.note || r; }).join(' ');
    injectUpdateBanner(info.version, rawNotes);
  });

  autoUpdater.on('update-not-available', function() {
    isDownloading = false;
    currentVersion = null;
    removeStatusBar();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.executeJavaScript(`(function(){
      var t=document.createElement('div');
      t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);z-index:999999;' +
        'background:#0d1b2a;border:1px solid rgba(0,229,255,0.2);border-radius:10px;' +
        'padding:10px 20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;' +
        'font-size:13px;color:#94a3b8;opacity:0;transition:opacity 0.3s ease,transform 0.3s ease;pointer-events:none;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.4);white-space:nowrap;';
      t.textContent='\u2713  You are on the latest version';
      document.body.appendChild(t);
      requestAnimationFrame(function(){t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)';});
      setTimeout(function(){t.style.opacity='0';t.style.transform='translateX(-50%) translateY(20px)';
        setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},350);},3500);
    })()`).catch(function(){});
  });

  autoUpdater.on('error', function() {
    isDownloading = false;
    currentVersion = null;
    if (mainWindow) mainWindow.setProgressBar(-1);
    removeStatusBar();
  });

  var checkUpdate = function() { autoUpdater.checkForUpdates().catch(function() {}); };
  setTimeout(checkUpdate, 5000);
  setInterval(checkUpdate, 30 * 60 * 1000);
}

// ─── Update banner ────────────────────────────────────────────────────────────

function injectUpdateBanner(version, rawNotes) {
  if (!mainWindow) return;
  var bullets = [];
  if (rawNotes) {
    var clean = rawNotes.replace(/<[^>]*>/g, '').trim();
    var lines = clean.split(/\n/).map(function(l) { return l.replace(/^[-*•]+\s*/, '').trim(); }).filter(function(l) { return l.length > 3 && l.length < 120; });
    bullets = lines.slice(0, 4);
  }

  var bulletHtml = bullets.map(function(b) {
    return '<div style="display:flex;align-items:flex-start;gap:7px;margin-top:5px;">' +
      '<span style="margin-top:5px;width:4px;height:4px;border-radius:50%;background:#00e5ff;flex-shrink:0;display:inline-block;"></span>' +
      '<span style="font-size:12px;color:#94a3b8;line-height:1.5;">' + b.substring(0, 100) + '</span></div>';
  }).join('');

  var whatsNew = bulletHtml
    ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:1.2px;color:#475569;text-transform:uppercase;margin-bottom:2px;">What\'s new</div>' +
      bulletHtml + '</div>'
    : '';

  var js = `(function() {
  if (document.getElementById('__fs-update-banner')) return;
  if (!document.getElementById('__fs-anim')) {
    var st=document.createElement('style');st.id='__fs-anim';
    st.textContent='@keyframes fsOvIn{from{opacity:0}to{opacity:1}}@keyframes fsCdIn{from{opacity:0;transform:scale(0.94) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}';
    document.head.appendChild(st);
  }
  var overlay=document.createElement('div');
  overlay.id='__fs-update-banner';
  overlay.style.cssText='position:fixed;inset:0;z-index:9999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:fsOvIn 0.3s ease;';
  var card=document.createElement('div');
  card.style.cssText='background:linear-gradient(160deg,#0d1b2a 0%,#0a0f1a 60%,#0d1b2a 100%);border:1px solid rgba(0,229,255,0.2);border-radius:18px;padding:28px 28px 24px;width:380px;max-width:90vw;box-shadow:0 32px 80px rgba(0,0,0,0.7),inset 0 1px 0 rgba(255,255,255,0.06);animation:fsCdIn 0.35s cubic-bezier(0.34,1.56,0.64,1);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;position:relative;overflow:hidden;';
  card.innerHTML=` + '`' + `<div style="position:absolute;top:-40px;right:-40px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(0,229,255,0.06) 0%,transparent 70%);pointer-events:none;"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
      <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,rgba(0,229,255,0.13),rgba(0,152,179,0.1));border:1px solid rgba(0,229,255,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L13.5 8.5H20L14.5 12.5L16.5 19L12 15L7.5 19L9.5 12.5L4 8.5H10.5L12 2Z" fill="#00e5ff"/></svg>
      </div>
      <div><div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#00e5ff;margin-bottom:2px;">Update Ready</div>
        <div style="font-size:18px;font-weight:700;color:#f1f5f9;">Full Swap By Rich <span style="color:#00e5ff;">v` + version + `</span></div>
      </div>
    </div>
    <div style="font-size:13px;color:#64748b;margin-bottom:4px;">Downloaded and ready to install.</div>` + whatsNew + `
    <div style="display:flex;gap:10px;margin-top:20px;">
      <button id="__fs-ub-install" style="flex:1;background:linear-gradient(135deg,#00e5ff,#0098b3);color:#0a0f1a;border:none;padding:12px 0;border-radius:10px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 4px 20px rgba(0,229,255,0.35);transition:transform 0.15s ease;">Restart &amp; Install</button>
      <button id="__fs-ub-later" style="padding:12px 18px;background:transparent;color:#475569;border:1px solid #1e293b;border-radius:10px;font-size:13px;cursor:pointer;">Later</button>
    </div>` + '`' + `;
  card.querySelector('#__fs-ub-install').addEventListener('mouseover',function(){this.style.transform='scale(1.03)';});
  card.querySelector('#__fs-ub-install').addEventListener('mouseout',function(){this.style.transform='';});
  card.querySelector('#__fs-ub-install').addEventListener('click',function(){window.electronAPI&&window.electronAPI.installUpdate&&window.electronAPI.installUpdate();});
  card.querySelector('#__fs-ub-later').addEventListener('click',function(){overlay.remove();});
  overlay.appendChild(card);
  overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.remove();});
  document.body.appendChild(overlay);
})()`;

  mainWindow.webContents.executeJavaScript(js).catch(function() {});
}

// ─── Download status bar ──────────────────────────────────────────────────────

function injectStatusBar(text, pct) {
  if (!mainWindow) return;
  var safePct = Math.min(100, Math.max(0, pct || 0));
  var js = `(function() {
  var bar=document.getElementById('__fs-status-bar');
  if (!bar) {
    bar=document.createElement('div');bar.id='__fs-status-bar';
    bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999998;background:#0a0f1a;border-bottom:1px solid rgba(0,229,255,0.2);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;overflow:hidden;';
    var fill=document.createElement('div');fill.id='__fs-status-fill';
    fill.style.cssText='position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,rgba(0,229,255,0.08),rgba(0,229,255,0.04));transition:width 0.4s ease;width:0%;';
    var inner=document.createElement('div');inner.style.cssText='position:relative;padding:9px 20px;display:flex;align-items:center;gap:10px;';
    var dot=document.createElement('span');dot.style.cssText='width:6px;height:6px;border-radius:50%;background:#00e5ff;display:inline-block;flex-shrink:0;animation:fspulse 1s infinite;';
    if (!document.getElementById('__fs-kf')) { var s=document.createElement('style');s.id='__fs-kf';s.textContent='@keyframes fspulse{0%,100%{opacity:1}50%{opacity:0.3}}';document.head.appendChild(s); }
    var txt=document.createElement('span');txt.id='__fs-status-txt';txt.style.cssText='font-size:12px;color:#94a3b8;';
    var pctEl=document.createElement('span');pctEl.id='__fs-status-pct';pctEl.style.cssText='font-size:12px;color:#00e5ff;font-weight:600;margin-left:auto;';
    var track=document.createElement('div');track.style.cssText='position:absolute;bottom:0;left:0;right:0;height:2px;background:rgba(255,255,255,0.04);';
    var prog=document.createElement('div');prog.id='__fs-status-prog';prog.style.cssText='height:100%;background:linear-gradient(90deg,#00e5ff,#0098b3);transition:width 0.4s ease;width:0%;';
    track.appendChild(prog);inner.appendChild(dot);inner.appendChild(txt);inner.appendChild(pctEl);
    bar.appendChild(fill);bar.appendChild(inner);bar.appendChild(track);
    document.body.insertBefore(bar,document.body.firstChild);
  }
  var p=` + safePct + `;
  var fe=document.getElementById('__fs-status-fill');if(fe)fe.style.width=p+'%';
  var pe=document.getElementById('__fs-status-prog');if(pe)pe.style.width=p+'%';
  var te=document.getElementById('__fs-status-txt');if(te)te.textContent=` + JSON.stringify(text) + `;
  var pc=document.getElementById('__fs-status-pct');if(pc)pc.textContent=p>0?p+'%':'';
})()`;
  mainWindow.webContents.executeJavaScript(js).catch(function() {});
}

function removeStatusBar() {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript('var b=document.getElementById("__fs-status-bar");if(b)b.remove();').catch(function() {});
}

// ─── Connection restored toast ────────────────────────────────────────────────

function injectConnectionRestoredToast() {
  if (!mainWindow) return;
  var js = `(function() {
  var t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);z-index:999999;' +
    'background:linear-gradient(135deg,#0a2a1a,#0d3322);border:1px solid rgba(34,197,94,0.5);border-radius:10px;' +
    'padding:10px 20px;display:flex;align-items:center;gap:10px;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:13px;color:#e2e8f0;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.3s ease,transform 0.3s ease;pointer-events:none;';
  t.innerHTML='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;"></span>' +
    '<span><strong style="color:#22c55e;">Connection restored</strong> \u2014 you\u2019re back online</span>';
  document.body.appendChild(t);
  requestAnimationFrame(function(){t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)';});
  setTimeout(function(){t.style.opacity='0';t.style.transform='translateX(-50%) translateY(20px)';setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},350);},4000);
})()`;
  mainWindow.webContents.executeJavaScript(js).catch(function() {});
}

// ─── Permissions ──────────────────────────────────────────────────────────────

function setupPermissions(win) {
  win.webContents.session.setPermissionRequestHandler(function(_wc, permission, callback) {
    callback(['media', 'camera', 'microphone', 'display-capture'].includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler(function(_wc, permission) {
    return ['media', 'camera', 'microphone', 'display-capture'].includes(permission);
  });
}

// ─── System tray ──────────────────────────────────────────────────────────────

function setupTray() {
  var iconPath = process.platform === 'win32'
    ? path.join(__dirname, '..', 'build', 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.png');
  try { tray = new Tray(iconPath); } catch (_) {
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

// ─── Splash ───────────────────────────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420, height: 320, frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

// ─── Main window ──────────────────────────────────────────────────────────────

function createMainWindow() {
  var state = loadWindowState();
  var wasOffline = false;
  var firstLaunch = isFirstLaunch();

  var winOptions = {
    width: state.width, height: state.height, minWidth: 960, minHeight: 600,
    show: false, opacity: 0, title: 'Full Swap By Rich', backgroundColor: '#0a0f1a',
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

  // Set theme cookie before first request
  applyThemeToSession(mainWindow.webContents.session);

  // Inject X-Color-Scheme header on every request to the server
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://fullswapbyrich.xyz/*', 'https://*.fullswapbyrich.xyz/*'] },
    function(details, callback) {
      details.requestHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      details.requestHeaders['Pragma'] = 'no-cache';
      details.requestHeaders['X-Color-Scheme'] = getThemeLabel();
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
    // Always apply current theme attribute after load
    applyThemeToWindow(mainWindow);
    // Connection restored toast
    if (wasOffline && url.startsWith(SERVER_URL)) { wasOffline = false; injectConnectionRestoredToast(); }
    // First-launch welcome screen — show once, then never again
    if (firstLaunch && url.startsWith(SERVER_URL)) { firstLaunch = false; injectWelcomeScreen(); }
  });

  mainWindow.on('close', function(e) {
    saveWindowState(mainWindow);
    if (process.platform !== 'darwin' && !app.isQuiting) {
      e.preventDefault(); mainWindow.hide();
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

// ─── Menu ─────────────────────────────────────────────────────────────────────

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
        { role: 'togglefullscreen' }, { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      ],
    },
  ]));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async function() {
  await session.defaultSession.clearCache().catch(function() {});
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }).catch(function() {});

  // IPC handlers
  ipcMain.on('install-update', function() { autoUpdater.quitAndInstall(false, true); });
  ipcMain.on('check-for-updates', function() { autoUpdater.checkForUpdates().catch(function() {}); });
  ipcMain.on('mark-launched', function() { markLaunched(); });
  ipcMain.handle('get-theme', function() { return getThemeLabel(); });

  createSplash();
  createMainWindow();
  buildMenu();
  setupTray();
  if (app.isPackaged) setupAutoUpdater();

  // Real-time theme sync when user changes OS theme
  nativeTheme.on('updated', function() {
    applyThemeToSession(session.defaultSession);
    applyThemeToWindow(mainWindow);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('theme-changed', getThemeLabel());
    }
  });

  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('before-quit', function() { app.isQuiting = true; });
app.on('window-all-closed', function() {});
