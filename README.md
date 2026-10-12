# Trackpad - Phone to PC barcode scanner

Two apps:

| Folder | What it is | Tech |
|---|---|---|
| `pc-app/` | Desktop app (Windows / macOS / Linux). Shows a pairing QR, receives scans and types them into the active window. Also detects USB barcode scanners. | Electron + Node |
| `mobile-app/` | Phone app (Android + iOS). Opens straight into the scanner. After a scan it shows the result and a **Scan again** button. | React Native (Expo) |

## Easiest: get the APK and the Windows installer automatically (no SDK, no npm)

1. Make a free account at github.com and create a new empty repository.
2. Upload everything inside this folder (drag and drop in the browser, keep the `.github` folder).
3. Open the **Actions** tab, choose **Build Trackpad apps**, click **Run workflow**.
4. After about 10 minutes, open the finished run and download:
   - **Trackpad-Android-APK** - unzip, send the .apk to your phone, tap to install (allow "install unknown apps").
   - **Trackpad-Windows-Setup** - unzip, double-click the .exe to install.

## Developer way (needs Node.js)

## 1. PC app

Needs Node.js 20+ (https://nodejs.org).

    cd pc-app
    npm install
    npm start

To make an installer (.exe / .dmg / AppImage): `npm run build` (output in `pc-app/dist`).

First run: allow Trackpad through the firewall when Windows asks (Private networks).
macOS: allow Trackpad in System Settings > Privacy & Security > Accessibility (needed to type).
Linux: works on X11; Wayland blocks typing into other apps.

## 2. Mobile app

    cd mobile-app
    npm install
    npx expo start

Scan the terminal QR with **Expo Go** on your phone to test right away.

Install a real app on Android (APK):

    npx eas-cli login          # free Expo account
    npx eas-cli build -p android --profile preview

You get a download link to the .apk. iOS: `npx eas-cli build -p ios` (needs an Apple developer account).

## 3. Use it

1. Phone and PC on the same Wi-Fi/LAN.
2. Start Trackpad on the PC - a QR code appears.
3. Open Trackpad on the phone, point the scanner at the PC QR. Connected - remembered forever.
4. Click into any program on the PC (Excel, POS, browser...) and scan. The code is typed + Enter.
5. Phone shows the code and "Sent to PC". Tap **Scan again** for the next one.

USB scanners: just plug in. Trackpad shows "USB scanner connected" and the scanner types into the active window as usual.

## Notes
- Rename the brand in `pc-app/src/config.js` (and `name` in `mobile-app/app.json`).
- If the PC gets a new IP the phone reconnects automatically; if not, scan the PC QR again.
- Traffic stays inside your local network and is protected by a secret key in the QR code.
- Options on the PC: turn typing off, or turn off the Enter key after each scan.
