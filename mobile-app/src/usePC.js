import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const QR_PREFIX = 'TRACKPAD|';
const KEY = 'trackpad.pc';
const PHONE_NAME = Platform.OS === 'ios' ? 'iPhone' : 'Android phone';

// Opens a socket to one host and resolves with it once open (or null on failure/timeout).
function tryHost(host, cfg) {
  return new Promise((resolve) => {
    let done = false;
    const url = `ws://${host}:${cfg.p}/?token=${encodeURIComponent(cfg.t)}&name=${encodeURIComponent(PHONE_NAME)}`;
    const ws = new WebSocket(url);
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!val) { try { ws.close(); } catch {} }
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 2500);
    ws.onopen = () => finish(ws);
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

/**
 * status: 'idle' (not paired) | 'connecting' | 'connected' | 'offline'
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
  const pending = useRef(new Map()); // id -> item waiting for the PC's ack
  const outbox = useRef([]);         // scans made while offline (expire after 15s)

  const clearTimers = () => {
    clearTimeout(retryTimer.current);
    clearInterval(pingTimer.current);
  };

  const transmit = useCallback((item) => {
    const ws = wsRef.current;
    pending.current.set(item.id, item);
    try {
      ws.send(JSON.stringify({ type: 'scan', id: item.id, code: item.code, format: item.format }));
    } catch {
      pending.current.delete(item.id);
      item.resolve('failed');
      return;
    }
    item.timer = setTimeout(() => {
      if (pending.current.delete(item.id)) item.resolve('failed');
    }, 3000);
  }, []);

  const scheduleRetry = useCallback((fn) => {
    clearTimeout(retryTimer.current);
    if (pcRef.current) retryTimer.current = setTimeout(fn, 3000);
  }, []);

  const connect = useCallback(async () => {
    const cfg = pcRef.current;
    if (!cfg || connecting.current) return;
    if (wsRef.current && wsRef.current.readyState === 1) return;
    connecting.current = true;
    setStatus('connecting');

    let ws = null;
    for (const host of cfg.h) {
      ws = await tryHost(host, cfg);
      if (ws) break;
    }
    connecting.current = false;

    if (!ws || pcRef.current !== cfg) {
      if (ws) ws.close();
      setStatus(pcRef.current ? 'offline' : 'idle');
      scheduleRetry(connect);
      return;
    }

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
    ws.onclose = (e) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      clearInterval(pingTimer.current);
      for (const item of pending.current.values()) { clearTimeout(item.timer); item.resolve('failed'); }
      pending.current.clear();
      if (e && e.code === 4001) {
        // PC rejected our key (it was reset) -> user must pair again
        AsyncStorage.removeItem(KEY).catch(() => {});
        pcRef.current = null;
        setPc(null);
        setStatus('idle');
        return;
      }
      setStatus('offline');
      scheduleRetry(connect);
    };
    ws.onerror = () => {};

    // Keep-alive so a dead Wi-Fi link is noticed quickly
    clearInterval(pingTimer.current);
    pingTimer.current = setInterval(() => {
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { try { ws.close(); } catch {} }
    }, 6000);

    // Send anything scanned a moment ago while we were reconnecting
    const queued = outbox.current.splice(0);
    queued.forEach((item) => { clearTimeout(item.expire); transmit(item); });
  }, [scheduleRetry, transmit]);

  // Load saved PC on start, then connect
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!alive) return;
        if (raw) {
          const cfg = JSON.parse(raw);
          pcRef.current = cfg;
          setPc(cfg);
          connect();
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') connect();
    });
    return () => {
      alive = false;
      sub.remove();
      clearTimers();
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [connect]);

  // Pair from the QR shown in the PC app. Returns the PC name, or null if invalid.
  const pair = useCallback((text) => {
    try {
      const cfg = JSON.parse(text.slice(QR_PREFIX.length));
      if (!Array.isArray(cfg.h) || !cfg.h.length || !cfg.p || !cfg.t) return null;
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
      clearTimers();
      connecting.current = false;
      pcRef.current = cfg;
      setPc(cfg);
      AsyncStorage.setItem(KEY, JSON.stringify(cfg)).catch(() => {});
      connect();
      return cfg.n || 'PC';
    } catch {
      return null;
    }
  }, [connect]);

  const forget = useCallback(() => {
    clearTimers();
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
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
    // offline: try to reconnect and give up after 15s so old scans never get typed late
    item.expire = setTimeout(() => {
      const i = outbox.current.indexOf(item);
      if (i >= 0) { outbox.current.splice(i, 1); resolve('failed'); }
    }, 15000);
    outbox.current.push(item);
    connect();
  }), [connect, transmit]);

  return { pc, status, loaded, pair, forget, send, reconnect: connect };
}
