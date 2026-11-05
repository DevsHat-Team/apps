import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// The TrackPad website this phone saves stock to. The address and account are kept in app storage,
// the sign-in token in the phone's secure storage.
const KEY = 'trackpad.server';
const TOKEN = 'trackpad.token';
export const WEB_QR = 'TRACKPAD-WEB|';

/** "my-shop.vercel.app", "192.168.1.5:3000", "https://x.com/scan" → "https://my-shop.vercel.app", "http://192.168.1.5:3000", "https://x.com" */
export function cleanAddress(input) {
  let t = String(input || '').trim().replace(/\s+/g, '');
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) {
    const host = t.split('/')[0].split(':')[0];
    const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === 'localhost' || /\.local$/i.test(host);
    t = (local ? 'http://' : 'https://') + t;
  }
  const m = /^(https?):\/\/([^/?#]+)/i.exec(t);
  if (!m) return null;
  const host = m[2].toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host) || !host.replace(/:\d+$/, '').includes('.') && !host.startsWith('localhost')) return null;
  return `${m[1].toLowerCase()}://${host}`;
}

export const hostOf = (url) => String(url || '').replace(/^https?:\/\//, '');

/** Reads the QR from the website's Setup guide: TRACKPAD-WEB|{"u":"https://…"} */
export function readWebQR(text) {
  try {
    const cfg = JSON.parse(String(text).slice(WEB_QR.length));
    return cleanAddress(cfg.u);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(message, { status = 0, network = false } = {}) {
    super(message);
    this.status = status;
    this.network = network; // true: no answer came back (no internet, timeout). The request may or may not have arrived.
  }
}

async function request(base, token, method, path, body, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      // the token goes in a header; cookies are left out so an old browser cookie can never mix in
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const slow = e && e.name === 'AbortError';
    throw new ApiError(slow ? 'The server took too long to answer.' : 'No internet connection, or the server could not be reached.', { network: true });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = (data && data.error) || (res.status >= 500 ? 'The server had a problem. Please try again.' : `Request failed (${res.status}).`);
    // 502/503/504: the server (or the database) was busy; nothing was saved, so it is safe to send again
    throw new ApiError(msg, { status: res.status, network: res.status === 502 || res.status === 503 || res.status === 504 });
  }
  if (data === null) throw new ApiError('This address did not answer like a TrackPad website.', { status: res.status });
  return data;
}

/**
 * session: { url, role: 'admin' | 'employee', storeName } or null
 * api(method, path, body?, timeout?) → JSON; throws ApiError. A 401 signs the phone out (password changed).
 */
export function useServer() {
  const [session, setSession] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [signedOutWhy, setSignedOutWhy] = useState('');
  const tokenRef = useRef('');
  const sessionRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s && s.url && s.role) {
            tokenRef.current = (await SecureStore.getItemAsync(TOKEN).catch(() => null)) || '';
            sessionRef.current = s;
            if (alive) setSession(s);
          }
        }
      } catch {}
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  const forget = useCallback(async (why = '') => {
    sessionRef.current = null;
    tokenRef.current = '';
    setSession(null);
    setSignedOutWhy(why);
    await AsyncStorage.removeItem(KEY).catch(() => {});
    await SecureStore.deleteItemAsync(TOKEN).catch(() => {});
  }, []);

  const signIn = useCallback(async (address, password, role) => {
    const url = cleanAddress(address);
    if (!url) throw new ApiError('Enter the website address, for example my-shop.vercel.app');
    let r;
    try {
      r = await request(url, '', 'POST', '/api/auth/login', { password, role, app: true }, 20000);
    } catch (e) {
      if (e.network) throw new ApiError(`Couldn't reach ${hostOf(url)}. Check the address and the internet.`, { network: true });
      throw e;
    }
    if (!r || r.ok !== true) throw new ApiError('This address did not answer like a TrackPad website.');
    const token = r.token || '';
    // older TrackPad websites sign in with a cookie only: the phone needs the newer website for direct saving
    if (!token && r.role !== 'admin') throw new ApiError('Update the TrackPad website first: this version cannot sign in phones.');
    // one real call with the token, so a wrong address or an old website shows now and not at the first scan
    await request(url, token, 'GET', '/api/ping', undefined, 15000).catch((e) => {
      throw e.status === 401 ? new ApiError('Update the TrackPad website first: this version cannot sign in phones.') : e;
    });
    const s = { url, role: r.role === 'employee' ? 'employee' : 'admin', storeName: r.storeName || '', at: Date.now() };
    tokenRef.current = token;
    sessionRef.current = s;
    await SecureStore.setItemAsync(TOKEN, token).catch(() => {});
    await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
    setSignedOutWhy('');
    setSession(s);
    return s;
  }, []);

  const api = useCallback(async (method, path, body, timeout) => {
    const s = sessionRef.current;
    if (!s) throw new ApiError('Sign in first.');
    try {
      return await request(s.url, tokenRef.current, method, path, body, timeout);
    } catch (e) {
      if (e.status === 401 && sessionRef.current === s) forget('You were signed out (the password was changed). Sign in again.');
      throw e;
    }
  }, [forget]);

  return { session, loaded, signIn, signOut: () => forget(''), signedOutWhy, api };
}
