const $ = (id) => document.getElementById(id);
const history = [];
let state = null;
let showPair = false;      // user asked to pair another phone
let wasConnected = false;
let usbSeenInWindow = false;

function render(s) {
  state = s;

  if (s.connected && !wasConnected) showPair = false; // phone just connected -> back to status view
  wasConnected = s.connected;

  if (s.qr) {
    $('qr').src = s.qr;
    $('qrLoading').classList.add('hidden');
  }

  // QR is only needed for the very first pairing (or when adding another phone)
  const pairing = !s.paired || showPair;
  $('pairCard').classList.toggle('hidden', !pairing);
  $('readyCard').classList.toggle('hidden', pairing);
  $('pairBack').classList.toggle('hidden', !(s.paired && showPair));

  $('ring').classList.toggle('on', s.connected);
  $('readyTitle').textContent = s.connected ? 'Phone connected' : 'Waiting for your phone';

  // USB scanner
  const usb = s.scanners.length > 0 || usbSeenInWindow;
  $('usbDot').className = 'dot ' + (usb ? 'green' : 'grey');
  $('usbText').textContent = usb ? 'USB scanner connected' : 'No USB scanner';
  document.querySelector('.slim').classList.toggle('on', usb);

  const warn = $('warn');
  if (!s.keyboardOk) {
    warn.textContent = 'Typing module failed to load. Please reinstall TrackPad.';
    warn.classList.remove('hidden');
  } else if (s.error) {
    warn.textContent = s.error;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
}

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
    tag.className = 'tag' + (h.error ? ' err' : '');
    tag.textContent = h.error ? 'not typed' : h.source === 'usb' ? 'USB' : 'Phone';
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

window.trackpad.onState(render);
window.trackpad.onScan(addHistory);
window.trackpad.getState().then(render);
drawHistory();

$('pairAnother').addEventListener('click', () => { showPair = true; render(state); });
$('pairBack').addEventListener('click', () => { showPair = false; render(state); });
$('clear').addEventListener('click', () => { history.length = 0; drawHistory(); });

// A USB scanner "types" a whole barcode in a few ms and ends with Enter.
// A human cannot, so a fast burst + Enter = hardware scanner.
let buf = '';
let fast = 0;
let lastKey = 0;
document.addEventListener('keydown', (e) => {
  const now = performance.now();
  if (e.key === 'Enter') {
    if (buf.length >= 4 && fast >= buf.length - 1) {
      usbSeenInWindow = true;
      addHistory({ code: buf, source: 'usb', time: Date.now() });
      if (state) render(state);
    }
    buf = ''; fast = 0; lastKey = 0;
    return;
  }
  if (e.key.length !== 1) return;
  const gap = now - lastKey;
  lastKey = now;
  if (gap > 80) { buf = ''; fast = 0; } else if (buf) { fast++; }
  buf += e.key;
}, true);
