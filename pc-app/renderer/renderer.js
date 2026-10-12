const $ = (id) => document.getElementById(id);
const history = [];
let usbSeenInWindow = false;

// ---------- render state coming from the main process ----------
function render(s) {
  // QR
  if (s.qr) {
    $('qr').src = s.qr;
    $('qrLoading').classList.add('hidden');
  }
  $('addr').textContent = s.hosts && s.hosts.length && s.port
    ? `${s.pcName}  ·  ${s.hosts[0]}:${s.port}`
    : s.error || 'No network found - connect this PC to Wi-Fi / LAN';

  // Phone status
  const on = s.devices.length > 0;
  $('pill').className = 'pill ' + (on ? 'on' : 'off');
  $('pillText').textContent = on
    ? (s.devices.length === 1 ? `${s.devices[0].name} connected` : `${s.devices.length} phones connected`)
    : 'Waiting for phone';

  $('devices').innerHTML = '';
  for (const d of s.devices) {
    const el = document.createElement('div');
    el.className = 'device';
    el.innerHTML = '<span class="dot green"></span><span></span><small></small>';
    el.children[1].textContent = d.name;
    el.children[2].textContent = d.ip;
    $('devices').appendChild(el);
  }

  // USB scanner
  if (s.scanners.length) {
    $('scannerDot').className = 'dot green';
    $('scannerTitle').textContent = s.scanners.map((x) => x.name).join(', ');
    $('scannerSub').textContent = 'Connected - scans type straight into the active window.';
  } else if (usbSeenInWindow) {
    $('scannerDot').className = 'dot green';
    $('scannerTitle').textContent = 'USB scanner active';
    $('scannerSub').textContent = 'Detected from fast keyboard input - scans type straight into the active window.';
  } else {
    $('scannerDot').className = 'dot grey';
    $('scannerTitle').textContent = 'No scanner detected';
    $('scannerSub').textContent = 'Plug in a USB scanner and it will show up here automatically.';
  }

  // Options
  $('optType').checked = s.settings.typeIntoApp;
  $('optEnter').checked = s.settings.pressEnter;

  // Warnings
  const warn = $('warn');
  if (!s.keyboardOk) {
    warn.textContent = 'Keyboard module failed to load - typing into other apps will not work. Run "npm install" again.';
    warn.classList.remove('hidden');
  } else if (s.error) {
    warn.textContent = s.error + (navigator.platform.includes('Mac') ? ' (macOS: allow Trackpad in Privacy > Accessibility)' : '');
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
}

// ---------- history ----------
function addHistory(entry) {
  history.unshift(entry);
  if (history.length > 100) history.pop();
  drawHistory();
}
function drawHistory() {
  const ul = $('history');
  ul.innerHTML = '';
  $('empty').classList.toggle('hidden', history.length > 0);
  for (const h of history) {
    const li = document.createElement('li');
    li.className = 'item';
    const tag = document.createElement('span');
    tag.className = 'tag ' + (h.error ? 'err' : h.source === 'usb' ? 'usb' : '');
    tag.textContent = h.error ? 'not typed' : h.source === 'usb' ? 'USB' : h.device || 'Phone';
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = h.code;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.append(tag, code, time);
    ul.appendChild(li);
  }
}

// ---------- wire up ----------
window.trackpad.onState(render);
window.trackpad.onScan(addHistory);
window.trackpad.getState().then(render);
drawHistory();

$('optType').addEventListener('change', (e) => window.trackpad.setSetting('typeIntoApp', e.target.checked));
$('optEnter').addEventListener('change', (e) => window.trackpad.setSetting('pressEnter', e.target.checked));
$('clear').addEventListener('click', () => { history.length = 0; drawHistory(); });

// ---------- detect a hardware scanner by typing speed ----------
// USB scanners "type" a whole barcode in a few milliseconds and finish with Enter.
// A human can't do that, so a fast burst ending in Enter = scanner.
let buf = '';
let fast = 0;
let lastKey = 0;
document.addEventListener('keydown', (e) => {
  const now = performance.now();
  if (e.key === 'Enter') {
    if (buf.length >= 4 && fast >= buf.length - 1) {
      usbSeenInWindow = true;
      addHistory({ code: buf, source: 'usb', time: Date.now() });
      window.trackpad.getState().then(render);
    }
    buf = ''; fast = 0; lastKey = 0;
    return;
  }
  if (e.key.length !== 1) return;
  const gap = now - lastKey;
  lastKey = now;
  if (lastKey && gap > 80) { buf = ''; fast = 0; } else if (buf) { fast++; }
  buf += e.key;
}, true);
