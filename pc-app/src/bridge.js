// WebSocket bridge: the phone connects here and sends scans.
// Pure Node (no Electron) so it can be unit-tested.
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

function start({ token, preferredPort, onScan, onDevices }) {
  return new Promise((resolve, reject) => {
    let port = preferredPort;

    const listen = () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Trackpad bridge is running');
      });
      const wss = new WebSocketServer({ server });
      const clients = new Map(); // ws -> device
      let started = false;

      const emit = () => onDevices && onDevices([...clients.values()]);

      server.on('error', (err) => {
        if (!started && err.code === 'EADDRINUSE' && port < preferredPort + 20) {
          port += 1;
          listen();
        } else if (!started) {
          reject(err);
        } else {
          console.error('bridge error', err);
        }
      });

      wss.on('connection', (ws, req) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.searchParams.get('token') !== token) {
          ws.close(4001, 'bad token');
          return;
        }
        const device = {
          id: crypto.randomUUID(),
          name: (url.searchParams.get('name') || 'Phone').slice(0, 40),
          ip: String(req.socket.remoteAddress || '').replace('::ffff:', ''),
        };
        ws.isAlive = true;
        clients.set(ws, device);
        emit();
        ws.send(JSON.stringify({ type: 'welcome', pc: os.hostname() }));

        ws.on('pong', () => (ws.isAlive = true));
        ws.on('message', async (raw) => {
          let m;
          try { m = JSON.parse(raw.toString()); } catch { return; }
          ws.isAlive = true;
          if (m.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
          if (m.type === 'scan' && typeof m.code === 'string' && m.code.length) {
            let ok = true, error;
            try { await onScan(m, device); } catch (e) { ok = false; error = e.message; }
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ack', id: m.id, ok, error }));
          }
        });
        ws.on('close', () => { clients.delete(ws); emit(); });
        ws.on('error', () => {});
      });

      // Drop phones that silently vanished (e.g. Wi-Fi lost)
      const beat = setInterval(() => {
        for (const ws of wss.clients) {
          if (!ws.isAlive) { ws.terminate(); continue; }
          ws.isAlive = false;
          try { ws.ping(); } catch {}
        }
      }, 8000);

      server.listen(port, '0.0.0.0', () => {
        started = true;
        resolve({
          port,
          close: () => { clearInterval(beat); wss.close(); server.close(); },
        });
      });
    };

    listen();
  });
}

// Best LAN addresses first (192.168.x.x, 10.x.x.x, 172.16-31.x.x), skip virtual adapters.
function lanAddresses() {
  const out = [];
  const bad = /vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|utun|br-|veth/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (bad.test(name)) continue;
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

module.exports = { start, lanAddresses };
