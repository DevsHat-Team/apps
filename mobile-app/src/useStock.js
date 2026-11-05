import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { feedback } from './feedback';

export const EMPLOYEE_UNDO_MIN = 15; // the same limit as the website
const DAY = 24 * 3600_000;
const RETRY_WAIT = [800, 2000]; // a weak connection: the same scan is sent again (the server saves it only once)

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const newId = () => ('tp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8)).padEnd(20, '0');

/** the label numbers a scan may mean: exact, digits only, the 8-digit serial inside a longer number, missing leading zeros */
export function tries(code) {
  const d = code.replace(/\D/g, '');
  return [...new Set([code, d, d.length > 8 ? d.slice(-8) : '', d.length > 8 ? d.slice(0, 8) : '', d.length && d.length < 8 ? d.padStart(8, '0') : ''].filter(Boolean))];
}

/**
 * Everything the phone needs to save stock: the label list (so a scan is found at once), the save queue (in scan
 * order, sent again on a weak connection, kept if the app closes), the recent activity of this account and undo.
 */
export function useStock({ api, session }) {
  const admin = session?.role === 'admin';
  const scope = session ? `${session.url}|${session.role}` : '';

  // ---------- label list ----------
  const index = useRef(new Map());
  const indexAt = useRef(0);
  // admin: each item's stock now (all its batches), from the label list — so every row shows "N left",
  // also after the app was closed and opened again
  const [stockNow, setStockNow] = useState(() => new Map());
  const loadIndex = useCallback(async () => {
    try {
      const r = await api('GET', '/api/scan-index', undefined, 30000);
      const m = new Map();
      for (const it of r.items || []) m.set(it[0], it);
      index.current = m;
      if (r.admin) {
        const t = new Map();
        for (const it of r.items || []) if (typeof it[6] === 'number') t.set(it[3], (t.get(it[3]) || 0) + it[6]);
        setStockNow(t);
      }
      indexAt.current = Date.now();
    } catch {}
  }, [api]);
  const idxTimer = useRef(null);
  const loadIndexSoon = useCallback(() => {
    clearTimeout(idxTimer.current);
    idxTimer.current = setTimeout(loadIndex, 1500);
  }, [loadIndex]);

  // row: [barcode, batchId, batchNo, productId, name, brand, …numbers the phone does not need]
  const toFound = (r) => ({ batchId: r[1], barcode: r[0], batchNo: r[2], productId: r[3], name: r[4], brand: r[5] });

  /** label → item. From the list on the phone; a label printed a moment ago is asked from the server. */
  const find = useCallback(async (code) => {
    for (const k of tries(code)) {
      const r = index.current.get(k);
      if (r) return toFound(r);
    }
    const r = await api('GET', `/api/barcode/${encodeURIComponent(code)}`);
    loadIndexSoon();
    return { batchId: r.batch.id, barcode: r.batch.barcode, batchNo: r.batch.batchNo, productId: r.product.id, name: r.product.name, brand: r.product.brandName };
  }, [api, loadIndexSoon]);

  // ---------- entries (recent activity) ----------
  const [entries, setEntriesState] = useState([]);
  const entriesRef = useRef([]);
  const setEntries = useCallback((fn) => {
    const next = typeof fn === 'function' ? fn(entriesRef.current) : fn;
    entriesRef.current = next;
    setEntriesState(next);
  }, []);
  const patch = useCallback((key, p) => setEntries((x) => x.map((e) => (e.key === key ? { ...e, ...(typeof p === 'function' ? p(e) : p) } : e))), [setEntries]);

  const [flash, setFlash] = useState(null); // the big strip under the scan window
  const [net, setNet] = useState('ok'); // 'ok' | 'retrying' | 'offline'
  const cleared = useRef(0);

  // unsent scans survive closing the app: they are sent again on the next start
  const QUEUE = `trackpad.queue.${scope}`;
  const saveQueue = useCallback(() => {
    if (!scope) return;
    const q = entriesRef.current.filter((e) => e.req && (e.state === 'saving' || (e.state === 'failed' && e.retry)));
    (q.length ? AsyncStorage.setItem(QUEUE, JSON.stringify(q)) : AsyncStorage.removeItem(QUEUE)).catch(() => {});
  }, [QUEUE, scope]);

  // ---------- saving ----------
  const chain = useRef(Promise.resolve());
  const sendOne = useCallback(async (key) => {
    const e0 = entriesRef.current.find((e) => e.key === key);
    if (!e0 || !e0.req) return;
    patch(key, { state: 'saving', error: '' });
    for (let i = 0; ; i++) {
      try {
        const r = await api('POST', '/api/movements', e0.req, 15000);
        setNet('ok');
        const via = r.adjusted ? `Scan · ${r.adjusted}` : e0.via;
        patch(key, { state: 'ok', ids: r.ids || [], via, left: admin && typeof r.productStock === 'number' ? r.productStock : null, req: null });
        // the item's other rows show the same stock now
        if (admin && typeof r.productStock === 'number') setStockNow((m) => new Map(m).set(e0.productId, r.productStock));
        setFlash((f) => (f && f.entry === key ? { ...f, state: 'ok', left: admin ? r.productStock : null, low: admin && r.low ? r.threshold : null, adjusted: r.adjusted || null } : f));
        loadIndexSoon();
        return true;
      } catch (err) {
        if (err.network && i < RETRY_WAIT.length) {
          setNet('retrying');
          await sleep(RETRY_WAIT[i]);
          continue;
        }
        if (err.network) setNet('offline');
        // Stock Out on a batch with nothing left: the server refuses it, so it is not counted. Said plainly: Stock 0.
        const empty = !err.network && e0.type === 'OUT' && /no .+ left in stock|nothing left in stock|has only 0 /i.test(err.message || '');
        const msg = err.network ? 'Not saved: no connection. It is sent again by itself when the internet is back.'
          : empty ? `Batch ${e0.via.replace(/^Scan · /, '')} has nothing left, so it was not taken out.` : err.message || 'Not saved';
        patch(key, { state: 'failed', error: msg, retry: !!err.network, empty });
        setFlash((f) => (f && f.entry === key ? { ...f, state: 'failed', msg, empty } : f));
        feedback('error');
        if (!err.network) loadIndexSoon();
        return false;
      } finally {
        saveQueue();
      }
    }
  }, [api, patch, admin, loadIndexSoon, saveQueue]);

  const queue = useCallback((key) => {
    chain.current = chain.current.then(() => sendOne(key)).catch(() => {});
    return chain.current;
  }, [sendOne]);

  /** scans that could not be sent (no internet) go again; the server saves each one only once */
  const resendBusy = useRef(false);
  const resendFailed = useCallback(async () => {
    if (resendBusy.current) return;
    const waiting = entriesRef.current.filter((e) => e.state === 'failed' && e.retry && e.req).reverse(); // oldest first
    if (!waiting.length) return;
    resendBusy.current = true;
    for (const e of waiting) {
      const ok = await queue(e.key);
      if (!ok && entriesRef.current.find((x) => x.key === e.key)?.retry) break; // still offline: try again later
    }
    resendBusy.current = false;
  }, [queue]);

  /** one scan = one unit, saved at once */
  const book = useCallback((found, type) => {
    const key = newId();
    const entry = {
      key, ids: [], type, qty: 1, at: Date.now(), name: found.name, productId: found.productId, batchId: found.batchId,
      via: `Scan · ${found.batchNo}`, state: 'saving', error: '', retry: false, left: null,
      req: { batchId: found.batchId, type, quantity: 1, note: null, clientId: key },
    };
    setEntries((x) => [entry, ...x]);
    setFlash({ key: Date.now(), entry: key, name: found.name, batchNo: found.batchNo, type, state: 'saving' });
    saveQueue();
    queue(key).then((ok) => { if (ok) resendFailed(); });
    return key;
  }, [setEntries, queue, saveQueue, resendFailed]);

  const retry = useCallback((key) => { queue(key).then((ok) => { if (ok) resendFailed(); }); }, [queue, resendFailed]);

  // ---------- undo ----------
  const canUndo = useCallback((e) => e.state === 'ok' && !e.added && e.ids.length > 0 && (admin || Date.now() - e.at < EMPLOYEE_UNDO_MIN * 60_000), [admin]);
  const undo = useCallback(async (e) => {
    if (!canUndo(e)) return;
    patch(e.key, { state: 'undoing' });
    try {
      const r = await api('POST', '/api/movements/undo', { ids: e.ids });
      setEntries((x) => x.filter((y) => y.key !== e.key));
      if (admin && typeof r.productStock === 'number') setStockNow((m) => new Map(m).set(e.productId, r.productStock));
      const what = `${e.qty} × ${e.name}`;
      setFlash({ key: Date.now(), undone: true, name: e.name, type: e.type, state: 'ok', msg: admin && typeof r.productStock === 'number' ? `Undone: ${what}. Stock is ${r.productStock} again.` : `Undone: ${what}.` });
      feedback('warn');
      loadIndexSoon();
    } catch (err) {
      patch(e.key, { state: 'ok' });
      setFlash({ key: Date.now(), name: e.name, type: e.type, state: 'failed', msg: err.message });
      feedback('error');
    }
  }, [api, admin, canUndo, patch, setEntries, loadIndexSoon]);

  /** Add new stock (admin) was saved: listed here (not undone from the phone: fix it on the website if needed) */
  const added = useCallback((r, productId) => {
    if (typeof r.after === 'number') setStockNow((m) => new Map(m).set(productId, r.after));
    setEntries((x) => [{ key: newId(), ids: [], type: 'IN', qty: r.qty, at: Date.now(), name: r.productName, productId, batchId: r.batch.id, via: `New stock · ${r.batch.batchNo}`, state: 'ok', added: true, left: r.after }, ...x]);
    loadIndexSoon();
  }, [setEntries, loadIndexSoon]);

  // ---------- the last 24 hours from the server ----------
  const [loadingList, setLoadingList] = useState(false);
  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await api('GET', '/api/movements/mine', undefined, 20000);
      const server = (r.items || []).map((m) => ({ key: m.id, ids: [m.id], type: m.type, qty: m.qty, at: m.at, name: m.name, productId: m.productId, batchId: m.batchId, via: m.via, state: 'ok', received: !!m.received, left: typeof m.left === 'number' ? m.left : null }));
      const have = new Set(server.map((m) => m.key));
      setEntries((old) => {
        // saved entries come from the server (an entry undone on the website disappears here too);
        // kept on the phone: not sent yet / failed, new stock, and a save from the last seconds the list may not have yet
        const keep = old
          .filter((e) => e.state !== 'ok' || e.added || (Date.now() - e.at < 15000 && !e.ids.every((id) => have.has(id))))
          // a scan that was waiting to be sent is already on the server (its answer was lost): it is saved
          .map((e) => (e.state === 'failed' && have.has(e.key) ? { ...e, state: 'ok', ids: [e.key], req: null, error: '', retry: false } : e));
        const ids = new Set(keep.flatMap((e) => [e.key, ...e.ids]));
        return [...keep, ...server.filter((m) => !ids.has(m.key))].filter((e) => e.at > cleared.current).sort((a, b) => b.at - a.at);
      });
      saveQueue();
      setNet('ok');
    } catch (e) {
      if (e.network) setNet('offline');
    }
    setLoadingList(false);
  }, [api, setEntries, saveQueue]);

  const clearList = useCallback(() => {
    cleared.current = Date.now();
    AsyncStorage.setItem(`trackpad.cleared.${scope}`, String(cleared.current)).catch(() => {});
    setEntries((x) => x.filter((e) => e.state === 'saving' || (e.state === 'failed' && e.retry)));
  }, [scope, setEntries]);

  // ---------- start, coming back to the app, every 2 minutes ----------
  useEffect(() => {
    if (!session) { setEntries([]); index.current = new Map(); return; }
    let alive = true;
    (async () => {
      cleared.current = 0; // the list always shows the full 24 hours (no Clear button on the phone)
      AsyncStorage.removeItem(`trackpad.cleared.${scope}`).catch(() => {});
      try {
        const raw = await AsyncStorage.getItem(QUEUE);
        const q = raw ? JSON.parse(raw) : [];
        if (alive && q.length) setEntries(q.map((e) => ({ ...e, state: 'failed', retry: true, error: 'Not sent yet' })));
      } catch {}
      if (!alive) return;
      loadIndex();
      await refresh();
      resendFailed();
    })();
    const t = setInterval(() => { if (AppState.currentState === 'active') loadIndex(); }, 120_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      if (Date.now() - indexAt.current > 30_000) loadIndex();
      refresh().then(resendFailed);
    });
    return () => { alive = false; clearInterval(t); sub.remove(); clearTimeout(idxTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // ---------- grouped by minute, then by item ----------
  const groups = useMemo(() => {
    const since = Date.now() - DAY;
    const minutes = [];
    const byMin = new Map();
    for (const e of entries) {
      if (e.at < since && e.state === 'ok') continue;
      const m = Math.floor(e.at / 60000);
      let blk = byMin.get(m);
      if (!blk) { blk = { minute: m, units: 0, rows: [], map: new Map() }; byMin.set(m, blk); minutes.push(blk); }
      const failed = e.state === 'failed';
      const gk = [e.productId, e.type, e.added ? 'a' : e.received ? 'r' : '', e.via, failed ? (e.empty ? 'e' : e.retry ? 'n' : 'f') : ''].join('|');
      let row = blk.map.get(gk);
      if (!row) { row = { key: `${m}|${gk}`, name: e.name, type: e.type, via: e.via, added: !!e.added, received: !!e.received, failed, empty: failed && !!e.empty, count: 0, items: [] }; blk.map.set(gk, row); blk.rows.push(row); }
      row.count += e.qty;
      row.items.push(e);
      if (row.left == null) row.left = stockNow.get(e.productId) ?? (typeof e.left === 'number' ? e.left : null);
      if (!failed) blk.units += e.qty;
    }
    minutes.sort((a, b) => b.minute - a.minute);
    return minutes;
  }, [entries, stockNow]);

  const pending = entries.filter((e) => e.state === 'saving').length;
  const unsent = entries.filter((e) => e.state === 'failed' && e.retry).length;
  const dismissFailed = useCallback((key) => { setEntries((x) => x.filter((e) => e.key !== key)); saveQueue(); }, [setEntries, saveQueue]);

  return { find, book, undo, canUndo, retry, added, refresh, clearList, dismissFailed, groups, entries, pending, unsent, flash, setFlash, net, loadingList, admin };
}
