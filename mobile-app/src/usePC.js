import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const QR_PREFIX = 'TRACKPAD|';
const KEY = 'trackpad.pc';
const PHONE = Platform.OS === 'ios' ? 'iPhone' : 'Android';

// Open a socket to one host. Resolves with the open socket, or null.
function tryHost(host, cfg, ms) {
  return new Promise((resolve) => {
    let done = false;
    const ws = new WebSocket(
      `ws://${host}:${cfg.p}/?token=${encodeURIComponent(cfg.t)}&name=${PHONE}`
    );
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!val) { try { ws.close(); } catch {} }
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), ms);
    ws.onopen = () => finish(ws);
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

// Try several known addresses at once; first to answer wins.
function race(hosts, cfg, ms) {
  return new Promise((resolve) => {
    let left = hosts.length;
    let won = false;
    if (!left) return resolve(null);
    hosts.forEach((host) =>
      tryHost(host, cfg, ms).then((ws) => {
        left -= 1;
        if (ws) {
          if (won) ws.close();
          else { won = true; resolve({ ws, host }); }
        }
        if (left === 0 && !won) resolve(null);
      })
    );
  });
}

// The PC got a new IP from the router? Look for it on the same Wi-Fi network.
// Only the PC that knows our secret key will accept the connection.
async function discover(cfg, shouldStop) {
  const known = new Set(cfg.h);
  const prefixes = [...new Set(cfg.h.map((h) => h.split('.').slice(0, 3).join('.')))];
  const list = [];
  prefixes.forEach((p) => {
    for (let i = 1; i < 255; i += 1) {
      const ip = `${p}.${i}`;
      if (!known.has(ip)) list.push(ip);
    }
  });
  let next = 0;
  let found = null;
  const worker = async () => {
    while (!found && !shouldStop() && next < list.length) {
      const ip = list[next++];
      const ws = await tryHost(ip, cfg, 700);
      if (ws) { if (found) ws.close(); else found = { ws, host: ip }; }
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  return found;
}

/**
 * status: 'idle' (no PC paired) | 'connecting' | 'connected' | 'offline'
 * send(id, code, format) -> Promise<'sent' | 'failed'>
 */
export function usePC() {
  const [pc, setPc] = useState(null);
  const [status, setStatus] = useState('idle');
  const [loaded, setLoaded] = useState(false);

  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const connecting = useRef(false);
  const retryTimer = useRef(null);
  const pingTimer = useRef(null);
  const lastDiscover = useRef(0);
  const appState = useRef(AppState.currentState);
  const connectRef = useRef(() => {});
  const pending = useRef(new Map());
  const outbox = useRef([]);

  const closeSocket = () => {
    clearInterval(pingTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
  };

  const scheduleRetry = useCallback(() => {
    clearTimeout(retryTimer.current);
    if (pcRef.current && appState.current === 'active') {
      retryTimer.current = setTimeout(() => connectRef.current(), 3000);
    }
  }, []);

  const transmit = useCallback((item) => {
    pending.current.set(item.id, item);
    try {
      wsRef.current.send(JSON.stringify({ type: 'scan', id: item.id, code: item.code, format: item.format }));
    } catch {
      pending.current.delete(item.id);
      item.resolve('failed');
      return;
    }
    item.timer = setTimeout(() => {
      if (pending.current.delete(item.id)) item.resolve('failed');
    }, 3000);
  }, []);

  const attach = useCallback((ws) => {
    wsRef.current = ws;
    setStatus('connected');

    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'ack') {
        const item = pending.current.get(m.id);
        if (item) {
          clearTimeout(item.timer);
          pending.current.delete(m.id);
          item.resolve(m.ok ? 'sent' : 'failed');
        }
      }
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      clearInterval(pingTimer.current);
      pending.current.forEach((item) => { clearTimeout(item.timer); item.resolve('failed'); });
      pending.current.clear();
      if (e && e.code === 4001) { // PC was reset and no longer knows this phone
        AsyncStorage.removeItem(KEY).catch(() => {});
        pcRef.current = null;
        setPc(null);
        setStatus('idle');
        return;
      }
      setStatus('offline');
      scheduleRetry();
    };

    clearInterval(pingTimer.current);
    pingTimer.current = setInterval(() => {
      try { ws.send('{"type":"ping"}'); } catch { try { ws.close(); } catch {} }
    }, 8000);

    // deliver scans made a moment ago while reconnecting
    outbox.current.splice(0).forEach((item) => { clearTimeout(item.expire); transmit(item); });
  }, [scheduleRetry, transmit]);

  const connect = useCallback(async () => {
    const cfg = pcRef.current;
    if (!cfg || connecting.current || appState.current !== 'active') return;
    if (wsRef.current && wsRef.current.readyState === 1) return;
    connecting.current = true;
    setStatus('connecting');

    let hit = await race(cfg.h, cfg, 1800);
    if (!hit && Date.now() - lastDiscover.current > 20000) {
      lastDiscover.current = Date.now();
      hit = await discover(cfg, () => pcRef.current !== cfg || appState.current !== 'active');
    }
    connecting.current = false;

    if (!hit || pcRef.current !== cfg) {
      if (hit) hit.ws.close();
      setStatus(pcRef.current ? 'offline' : 'idle');
      scheduleRetry();
      return;
    }
    if (!cfg.h.includes(hit.host)) { // remember the PC's new address
      const updated = { ...cfg, h: [hit.host, ...cfg.h].slice(0, 4) };
      pcRef.current = updated;
      setPc(updated);
      AsyncStorage.setItem(KEY, JSON.stringify(updated)).catch(() => {});
    }
    attach(hit.ws);
  }, [attach, scheduleRetry]);
  connectRef.current = connect;

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const cfg = JSON.parse(raw);
        pcRef.current = cfg;
        setPc(cfg);
        connectRef.current();
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));

    const sub = AppState.addEventListener('change', (s) => {
      appState.current = s;
      if (s === 'active') connectRef.current();
      else clearTimeout(retryTimer.current); // no background retries = no battery drain
    });
    return () => {
      alive = false;
      sub.remove();
      clearTimeout(retryTimer.current);
      closeSocket();
    };
  }, []);

  const pair = useCallback((text) => {
    try {
      const cfg = JSON.parse(text.slice(QR_PREFIX.length));
      if (!Array.isArray(cfg.h) || !cfg.h.length || !cfg.p || !cfg.t) return false;
      closeSocket();
      clearTimeout(retryTimer.current);
      connecting.current = false;
      lastDiscover.current = 0;
      pcRef.current = cfg;
      setPc(cfg);
      AsyncStorage.setItem(KEY, JSON.stringify(cfg)).catch(() => {});
      connectRef.current();
      return true;
    } catch {
      return false;
    }
  }, []);

  const forget = useCallback(() => {
    clearTimeout(retryTimer.current);
    closeSocket();
    pcRef.current = null;
    connecting.current = false;
    setPc(null);
    setStatus('idle');
    AsyncStorage.removeItem(KEY).catch(() => {});
  }, []);

  const send = useCallback((id, code, format) => new Promise((resolve) => {
    const item = { id, code, format, resolve };
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) return transmit(item);
    // offline: reconnect and give up after 15s so old scans are never typed late
    item.expire = setTimeout(() => {
      const i = outbox.current.indexOf(item);
      if (i >= 0) { outbox.current.splice(i, 1); resolve('failed'); }
    }, 15000);
    outbox.current.push(item);
    connectRef.current();
  }), [transmit]);

  return { pc, status, loaded, pair, forget, send, reconnect: connect };
}
