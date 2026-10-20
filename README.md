# TrackPad - Phone to PC barcode scanner

- `pc-app/`     Windows app (Electron). Runs in the background, starts with the PC, types scans into the active window.
- `mobile-app/` Android app (React Native / Expo). Opens straight into the scanner.

## Get the installers (no SDK, no npm)
1. Push this folder to GitHub (the `.github` folder must be included).
2. Open the repo > **Actions** > **Build Trackpad apps** (runs automatically on every push, or click **Run workflow**).
3. When both jobs are green, open the run and download from **Artifacts**:
   - `Trackpad-Android-APK` (arm64 phones, small size)
   - `Trackpad-Windows-Setup` (double-click to install)

## First use
1. Install TrackPad on the PC. It starts automatically and shows a QR code.
2. Open TrackPad on the phone, scan the PC QR once. The dot turns green.
3. Done. The PC app now runs in the background and starts with Windows. Open the phone app any time, scan, and it types into the active PC window. No QR needed again.

## Notes
- Phone and PC must be on the same Wi-Fi/LAN.
- If the router gives the PC a new IP, the phone finds it automatically.
- To quit the PC app fully: tray icon (bottom right) > Quit.
- Brand text: `pc-app/src/config.js`, `mobile-app/app.json`. Logo files: `pc-app/renderer/logo.png`, `mobile-app/assets/`.

## Developer commands
    cd pc-app && npm install && npm start
    cd mobile-app && npm install && npx expo start
