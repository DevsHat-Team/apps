const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const { BRAND, DEFAULT_PORT, QR_PREFIX } = require('./src/config');
const bridge = require('./src/bridge');
const keyboard = require('./src/keyboard');
const scanners = require('./src/scanners');

app.setAppUserModelId('com.trackpad.scan');

// Started by Windows at login? Then stay hidden in the tray.
const startHidden = process.argv.includes('--hidden');

// ---------- settings (kept between restarts) ----------
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
let settings = { token: crypto.randomBytes(8).toString('hex'), paired: false, port: null };
try {
  settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
} catch {}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch {}
}

// ---------- state ----------
let win = null;
let tray = null;
let server = null;
let quitting = false;
let qrDataUrl = '';
let phones = 0;
let usbScanners = [];
let lastError = '';

const buildState = () => ({
  qr: qrDataUrl,
  paired: settings.paired,
  connected: phones > 0,
  scanners: usbScanners,
  keyboardOk: keyboard.isReady(),
  error: lastError,
});
const pushState = () => {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState());
};
const pushScan = (entry) => {
  if (win && !win.isDestroyed()) win.webContents.send('scan', entry);
};

async function refreshQr() {
  if (!server) return;
  const payload =
    QR_PREFIX +
    JSON.stringify({ h: bridge.lanAddresses(), p: server.port, t: settings.token, n: os.hostname() });
  qrDataUrl = await QRCode.toDataURL(payload, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: 'M',
    color: { dark: '#07090F', light: '#FFFFFF' },
  });
}

// ---------- a scan arrives from the phone: type it + Enter, always ----------
async function handlePhoneScan(msg) {
  const code = String(msg.code).slice(0, 2000);
  const entry = { code, source: 'phone', time: Date.now() };
  try {
    await keyboard.typeText(code, { pressEnter: true });
    lastError = '';
  } catch (e) {
    lastError = e.message;
    entry.error = true;
    pushScan(entry);
    pushState();
    throw e;
  }
  pushScan(entry);
}

// ---------- window + tray ----------
function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 740,
    minWidth: 420,
    minHeight: 620,
    show: false,
    backgroundColor: '#07090F',
    title: BRAND,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', pushState);
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  // Never block Windows shutdown / logoff
  win.on('session-end', () => { quitting = true; });
  // Closing the window keeps TrackPad running in the background
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip(BRAND);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${BRAND}`, click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ])
  );
  tray.on('click', showWindow);
}

ipcMain.handle('state:get', () => buildState());

// ---------- boot ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* keep running in the tray */ });

  app.whenReady().then(async () => {
    saveSettings();
    createWindow();
    createTray();

    // Start with the computer, silently, so the phone can always connect
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    }

    try {
      server = await bridge.start({
        token: settings.token,
        preferredPort: settings.port || DEFAULT_PORT,
        onScan: handlePhoneScan,
        onDevices: (list) => {
          phones = list.length;
          if (phones && !settings.paired) {
            settings.paired = true;
            saveSettings();
            if (Notification.isSupported()) {
              new Notification({ title: BRAND, body: 'Phone connected. TrackPad now runs in the background.' }).show();
            }
          }
          pushState();
        },
      });
      if (settings.port !== server.port) { settings.port = server.port; saveSettings(); }
      await refreshQr();
    } catch (e) {
      lastError = 'Could not start: ' + e.message;
    }
    pushState();

    // Keep the QR current if Wi-Fi / network changes
    setInterval(async () => {
      const before = qrDataUrl;
      await refreshQr();
      if (before !== qrDataUrl) pushState();
    }, 15000);

    scanners.watch((list, added) => {
      usbScanners = list;
      if (added.length && Notification.isSupported()) {
        new Notification({ title: BRAND, body: 'USB scanner connected' }).show();
      }
      pushState();
    });
  });
}
