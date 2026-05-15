# Full Swap By Rich — Desktop App

Electron wrapper for the Full Swap By Rich AI face-swap studio.
Loads the hosted web app, enables camera/microphone access, and supports auto-updates via GitHub Releases.

## Requirements

- Node.js 20+
- The hosted server running (set `APP_SERVER_URL`)

## Development

```bash
cd desktop
npm install

# Point at your local dev server
APP_SERVER_URL=http://localhost:5173 npm start

# Or point at the live server
APP_SERVER_URL=https://your-domain.com npm start
```

## Building installers

```bash
cd desktop
npm install

# All platforms (run on the target OS or use GitHub Actions)
APP_SERVER_URL=https://your-domain.com npm run build:win    # → dist/*.exe
APP_SERVER_URL=https://your-domain.com npm run build:mac    # → dist/*.dmg
APP_SERVER_URL=https://your-domain.com npm run build:linux  # → dist/*.AppImage
```

Installers are output to `desktop/dist/`.

## GitHub Actions (automated)

Every push to `main` automatically:
1. Builds Windows, Mac, and Linux installers in parallel
2. Uploads them as GitHub Actions artifacts

When you create a **GitHub Release**, the installers are also attached to the release page for direct download.

## Setting the server URL

The desktop app points at whatever URL you set in `APP_SERVER_URL` at build time.

In GitHub Actions, set this as a repository variable:
1. Go to **Settings → Secrets and variables → Actions → Variables**
2. Add `APP_SERVER_URL` = `https://your-domain.com`

The app will then point all users at your hosted server automatically.

## Auto-updates

When a new release is published on GitHub:
1. The app checks for updates 5 seconds after launch
2. If an update is available the web app receives a notification (via `window.electronUpdater`)
3. Users can download and install the update from within the app

## Icon files needed

Place your app icons in `desktop/build/`:
- `icon.png` — 512×512 PNG (Linux + fallback)
- `icon.ico` — Windows icon
- `icon.icns` — macOS icon

Use a tool like https://www.electron.build/icons to convert a PNG to all formats.
