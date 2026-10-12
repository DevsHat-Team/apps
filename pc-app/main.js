const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const { BRAND, DEFAULT_PORT, QR_PREFIX } = require('./src/config');
const bridge = require('./src/bridge');
const keyboard = require('./src/keyboard');
const scanners = require('./src/scanners');

// ---------- settings (saved in the user profile) ----------
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  const defaults = {
    token: crypto.randomBytes(8).toString('hex'),
    typeIntoApp: true,
    pressEnter: true,
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    return defaults;
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch {}
}
let settings;

// ---------- runtime state ----------
let win = null;
let server = null;
let qrDataUrl = '';
let devices = [];
let usbScanners = [];
let lastError = '';

function buildState() {
  return {
    brand: BRAND,
    pcName: os.hostname(),
    qr: qrDataUrl,
    hosts: bridge.lanAddresses(),
    port: server ? server.port : null,
    devices,
    scanners: usbScanners,
    settings: { typeIntoApp: settings.typeIntoApp, pressEnter: settings.pressEnter },
    keyboardOk: keyboard.isReady(),
    error: lastError,
  };
}
function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState());
}

async function refreshQr() {
  if (!server) return;
  const payload =
    QR_PREFIX +
    JSON.stringify({
      h: bridge.lanAddresses(),
      p: server.port,
      t: settings.token,
      n: os.hostname(),
    });
  qrDataUrl = await QRCode.toDataURL(payload, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B1020', light: '#FFFFFF' },
  });
}

// ---------- handle a scan coming from the phone ----------
async function handlePhoneScan(msg, device) {
  const code = String(msg.code).slice(0, 2000);
  const entry = {
    code,
    format: msg.format || '',
    source: 'phone',
    device: device.name,
    time: Date.now(),
  };
  if (settings.typeIntoApp) {
    try {
      await keyboard.typeText(code, { pressEnter: settings.pressEnter });
      lastError = '';
    } catch (e) {
      lastError = e.message;
      entry.error = e.message;
      if (win && !win.isDestroyed()) win.webContents.send('scan', entry);
      pushState();
      throw e;
    }
  }
  if (win && !win.isDestroyed()) win.webContents.send('scan', entry);
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0B1020',
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
}

ipcMain.handle('state:get', () => buildState());
ipcMain.handle('setting:set', (_e, key, value) => {
  if (key === 'typeIntoApp' || key === 'pressEnter') {
    settings[key] = !!value;
    saveSettings();
    pushState();
  }
});

// ---------- boot ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    saveSettings();
    createWindow();

    try {
      server = await bridge.start({
        token: settings.token,
        preferredPort: DEFAULT_PORT,
        onScan: handlePhoneScan,
        onDevices: (list) => {
          const newcomer = list.find((d) => !devices.some((o) => o.id === d.id));
          devices = list;
          if (newcomer && Notification.isSupported()) {
            new Notification({ title: BRAND, body: `${newcomer.name} connected` }).show();
          }
          pushState();
        },
      });
      await refreshQr();
    } catch (e) {
      lastError = 'Could not start server: ' + e.message;
    }
    pushState();

    // Re-check network addresses if Wi-Fi changes
    setInterval(async () => {
      const before = qrDataUrl;
      await refreshQr();
      if (before !== qrDataUrl) pushState();
    }, 10000);

    // Detect USB hardware barcode scanners
    scanners.watch((list, added) => {
      usbScanners = list;
      if (added.length && Notification.isSupported()) {
        new Notification({ title: BRAND, body: `USB scanner connected: ${added[0].name}` }).show();
      }
      pushState();
    });
  });

  app.on('window-all-closed', () => {
    if (server) server.close();
    app.quit();
  });
}
