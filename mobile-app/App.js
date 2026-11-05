import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, AppState, Image, Linking, Platform, Pressable, ScrollView,
  StatusBar, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QR_PREFIX, usePC } from './src/usePC';
import { WEB_QR, hostOf, readWebQR, useServer } from './src/server';
import { useStock } from './src/useStock';
import { Activity } from './src/Activity';
import { AddStockSheet } from './src/AddStockSheet';
import { Menu, GUARDS } from './src/Menu';
import { Setup } from './src/Setup';
import { feedback, setSound } from './src/feedback';
import { C, TYPES } from './src/theme';


// Fewer formats = faster decoding and a cooler phone. Covers TrackPad labels (Code 128), shop barcodes and QR.
const FORMATS = ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'];
const SLEEP_PC = 45000; // camera switches off when nobody scans (saves heat + battery)
const SLEEP_STOCK = 90000;
const PREFS = 'trackpad.prefs';

const MODES = [
  { m: 'OUT', label: 'Stock Out', color: C.red, hint: TYPES.OUT.hint },
  { m: 'IN', label: 'Stock In', color: C.green, hint: TYPES.IN.hint },
  { m: 'RETURN', label: 'Return', color: C.amber, hint: TYPES.RETURN.hint },
  { m: 'NEW', label: 'Add stock', color: C.cyan, hint: 'Scan an item to add new stock', adminOnly: true },
  { m: 'PC', label: 'To PC', color: C.violet, hint: 'Scans are sent to the Scan station on your PC', pcOnly: true },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const { pc, status, loaded: pcLoaded, pair, forget, send, reconnect } = usePC();
  const server = useServer();
  const { session } = server;
  const stock = useStock({ api: server.api, session });
  const admin = session?.role === 'admin';

  // ----- what the scans do -----
  const [mode, setModeState] = useState('OUT');
  const modeRef = useRef('OUT');
  const seen = useRef(new Map()); // label → { seen: last read, counted: last counted, iv: time between reads }
  const setMode = useCallback((m) => { modeRef.current = m; setModeState(m); seen.current.clear(); }, []);
  const [setup, setSetup] = useState(false);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(null);
  const [guard, setGuard] = useState(500);
  const guardRef = useRef(500);
  const [sound, setSoundState] = useState(true);
  const [dupAt, setDupAt] = useState(0);
  const [note, setNote] = useState(''); // short message in the middle of the screen

  // start in the right mode: signed in → Stock Out (as on the website); only a PC → To PC
  const started = useRef(false);
  useEffect(() => {
    if (!server.loaded || !pcLoaded || started.current) return;
    started.current = true;
    setMode(session ? 'OUT' : pc ? 'PC' : 'OUT');
  }, [server.loaded, pcLoaded, session, pc, setMode]);
  useEffect(() => {
    if (!started.current) return;
    if (!session && modeRef.current !== 'PC' && pc) setMode('PC');
    if (session && !admin && modeRef.current === 'NEW') setMode('OUT');
  }, [session, admin, pc, setMode]);
  useEffect(() => { if (!pc && modeRef.current === 'PC') setMode('OUT'); }, [pc, setMode]);
  useEffect(() => { if (server.signedOutWhy) setSetup(true); }, [server.signedOutWhy]);

  useEffect(() => {
    AsyncStorage.getItem(PREFS).then((raw) => {
      const p = raw ? JSON.parse(raw) : {};
      if (GUARDS.includes(p.guard)) { setGuard(p.guard); guardRef.current = p.guard; }
      if (typeof p.sound === 'boolean') setSoundState(p.sound);
      setSound(p.sound !== false);
    }).catch(() => setSound(true));
  }, []);
  const savePrefs = (p) => AsyncStorage.setItem(PREFS, JSON.stringify({ guard: guardRef.current, sound, ...p })).catch(() => {});
  const changeGuard = (g) => { setGuard(g); guardRef.current = g; savePrefs({ guard: g }); };
  const changeSound = (v) => { setSoundState(v); setSound(v); savePrefs({ sound: v }); };

  // ----- PC mode (as before): one scan → sheet → Scan next -----
  const [result, setResult] = useState(null); // { id, state }
  const [torch, setTorch] = useState(false);
  const [awake, setAwake] = useState(true);
  const cam = useRef(null);
  const idle = useRef(null);
  const pop = useRef(new Animated.Value(0)).current;

  const touch = useCallback(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setAwake(false), modeRef.current === 'PC' ? SLEEP_PC : SLEEP_STOCK);
  }, []);
  useEffect(() => {
    touch();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { setAwake(true); touch(); } });
    return () => { sub.remove(); clearTimeout(idle.current); };
  }, [touch]);
  useEffect(() => {
    if (awake) activateKeepAwakeAsync('scan').catch(() => {});
    else { deactivateKeepAwake('scan'); setTorch(false); }
  }, [awake]);
  const wake = () => {
    setResult(null);
    pop.setValue(0);
    setAwake(true);
    touch();
  };

  const say = useCallback((msg) => {
    setNote(msg);
    setTimeout(() => setNote((n) => (n === msg ? '' : n)), 2200);
  }, []);

  const scanNext = useCallback(() => {
    feedback('select');
    try { cam.current?.resumePreview(); } catch {}
    setResult(null);
    pop.setValue(0);
    touch();
  }, [pop, touch]);

  const toPC = useCallback((code) => {
    feedback('select');
    try { cam.current?.pausePreview(); } catch {}
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setResult({ id, state: pc ? 'sending' : 'nopc' });
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 7, tension: 120 }).start();
    if (pc) send(id, code, 'scan').then((state) => setResult((r) => (r && r.id === id ? { ...r, state } : r)));
  }, [pc, send, pop]);

  // ----- stock modes: every scan is saved at once -----
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const stockRef = useRef(stock);
  stockRef.current = stock;
  const stockScan = useCallback(async (code, m) => {
    const stock = stockRef.current;
    let found;
    try {
      found = await stock.find(code);
    } catch (e) {
      feedback('error');
      stock.setFlash({ key: Date.now(), state: 'failed', name: e.status === 404 ? 'Unknown label' : 'Not found', msg: e.status === 404 ? `No item has the barcode ${code.slice(0, 30)}.` : e.message });
      return;
    }
    feedback('ok');
    if (m === 'NEW') { setAdding({ key: Date.now(), productId: found.productId, batchId: found.batchId }); return; }
    stock.book(found, m);
  }, []);

  // One label = one count, also when the camera sees it 10 times a second. A label counts again when
  //  1) it left the frame for a moment (no reads for a short gap: the next unit with the same label is shown), and
  //  2) the "same label wait" has passed since it was last counted (0.5 s by default).
  // So 10 units with the same label scan one after another, but a label held still in front of the camera counts once.
  // The gap follows how fast this phone's camera reads (a slow camera reads less often, so it gets a longer gap).
  const dupShown = useRef(0);
  const onScan = useCallback(({ data }) => {
    const c = String(data || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (!c) return;
    const now = Date.now();
    const r = seen.current.get(c);
    if (r) {
      const gap = now - r.seen;
      if (gap < 450) r.iv = r.iv ? r.iv * 0.7 + gap * 0.3 : gap; // time between two reads of a label that stays in view
      r.seen = now;
      const away = Math.min(700, Math.max(300, (r.iv || 120) * 2.5));
      const wait = c.startsWith(QR_PREFIX) || c.startsWith(WEB_QR) ? 2000 : guardRef.current;
      if (gap < away || now - r.counted < wait) {
        if (now - dupShown.current > 400 && modeRef.current !== 'PC' && now - r.counted > 900) { dupShown.current = now; setDupAt(now); }
        return;
      }
      r.counted = now;
    } else {
      seen.current.set(c, { seen: now, counted: now, iv: 0 });
      if (seen.current.size > 200) for (const [k, x] of seen.current) if (now - x.seen > 10000) seen.current.delete(k);
    }
    touch();

    if (c.startsWith(QR_PREFIX)) { // TrackPad Desktop pairing code
      const ok = pair(c);
      feedback(ok ? 'ok' : 'error');
      say(ok ? 'PC paired' : 'Invalid code');
      if (ok && !sessionRef.current) setMode('PC');
      return;
    }
    if (c.startsWith(WEB_QR)) { // the website's QR: sign in to it
      const url = readWebQR(c);
      if (sessionRef.current && url === sessionRef.current.url) { say('Already signed in here'); return; }
      setSetup({ address: url || '' });
      return;
    }
    const m = modeRef.current;
    if (m === 'PC') { toPC(c); return; }
    if (!sessionRef.current) { feedback('error'); say('Sign in first (⋯ menu)'); return; }
    stockScan(c, m);
  }, [touch, pair, say, setMode, toPC, stockScan]);

  // web preview / automated tests only: there is no camera decoder on the web, so a test can hand in a scan
  const scanningRef = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    globalThis.__tpScan = (code) => { if (scanningRef.current) onScan({ data: code }); return scanningRef.current; };
    return () => { delete globalThis.__tpScan; };
  }, [onScan]);

  // the strip under the scan window: stays a few seconds after the last scan
  const { flash, setFlash } = stock;
  useEffect(() => {
    if (!flash || flash.state === 'saving') return;
    const t = setTimeout(() => setFlash((f) => (f === flash ? null : f)), flash.state === 'failed' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [flash, setFlash]);
  const [, tick] = useState(0);
  useEffect(() => { if (!dupAt) return; const t = setTimeout(() => tick((x) => x + 1), 1700); return () => clearTimeout(t); }, [dupAt]);

  // ----- screens -----
  if (!server.loaded || !pcLoaded) return <View style={s.root} />;

  if (setup || (!session && !pc)) {
    return (
      <Setup
        key={typeof setup === 'object' ? setup.address : 'setup'}
        initialAddress={typeof setup === 'object' ? setup.address : ''}
        signIn={async (a, p, r) => { const x = await server.signIn(a, p, r); setSetup(false); setMode('OUT'); return x; }}
        pair={(t) => { const ok = pair(t); if (ok) { setSetup(false); if (!session) setMode('PC'); } return ok; }}
        why={server.signedOutWhy}
        pcPaired={!!pc}
        onCancel={session || pc ? () => setSetup(false) : null}
      />
    );
  }

  if (!permission) return <View style={s.root} />;
  if (!permission.granted) {
    return (
      <View style={[s.root, s.center]}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Image source={require('./assets/mark.png')} style={s.bigMark} />
        <Text style={s.h1}>Camera access</Text>
        <Text style={s.muted}>TrackPad needs the camera to read barcodes.</Text>
        <Pressable style={[s.btn, { alignSelf: 'stretch', marginTop: 24 }]} onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}>
          <Text style={s.btnText}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text>
        </Pressable>
      </View>
    );
  }

  const pcMode = mode === 'PC';
  const cur = MODES.find((x) => x.m === mode) || MODES[0];
  const modes = MODES.filter((x) => (x.pcOnly ? !!pc : !!session && (!x.adminOnly || admin)));

  // ----- layout -----
  const top = Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 20) + 8;
  const winW = Math.min(width * (pcMode ? 0.86 : 0.8), 360);
  const winH = Math.round(winW * (pcMode ? 0.6 : 0.5));
  const winX = Math.round((width - winW) / 2);
  const barsH = 56 + 50; // top bar + mode chips
  const winY = pcMode ? Math.round(height * 0.38 - winH / 2) : Math.round(top + barsH + 18);
  const stripY = winY + winH + 40;
  const panelTop = stripY + 76; // the list always stays in the same place (no moving panel)
  const done = !!result;
  const sheetOpen = done || !!adding || menu;
  const scanning = awake && !sheetOpen;
  scanningRef.current = scanning;
  const bracket = done ? C.green : pcMode ? C.cyan : cur.color;
  const dot = pcMode ? (status === 'connected' ? C.green : status === 'connecting' ? C.amber : C.red)
    : stock.net === 'ok' ? (stock.unsent ? C.amber : C.green) : stock.net === 'retrying' ? C.amber : C.red;

  const line = result && {
    sending: { c: '#8F9BC2', t: 'Sending…' },
    sent: { c: C.green, t: 'Sent to PC' },
    failed: { c: C.red, t: "Couldn't reach your PC" },
    nopc: { c: C.amber, t: 'Connect a PC first' },
  }[result.state];

  const showDup = !pcMode && Date.now() - dupAt < 1600 && (!flash || flash.state !== 'failed') && (!flash || Date.now() - flash.key > 1200);


  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {awake && (
        <CameraView
          ref={cam}
          style={StyleSheet.absoluteFill}
          facing="back"
          autofocus="on"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: FORMATS }}
          onBarcodeScanned={scanning ? onScan : undefined}
        />
      )}

      {awake ? (
        <>
          {/* dimmed surround with a clear scan window */}
          <View pointerEvents="none" style={[s.scrim, { top: 0, left: 0, right: 0, height: winY }]} />
          <View pointerEvents="none" style={[s.scrim, { top: winY + winH, left: 0, right: 0, bottom: 0 }]} />
          <View pointerEvents="none" style={[s.scrim, { top: winY, left: 0, width: winX, height: winH }]} />
          <View pointerEvents="none" style={[s.scrim, { top: winY, right: 0, width: winX, height: winH }]} />
          <View pointerEvents="none" style={{ position: 'absolute', left: winX, top: winY, width: winW, height: winH }}>
            <View style={[s.corner, s.tl, { borderColor: bracket }]} />
            <View style={[s.corner, s.tr, { borderColor: bracket }]} />
            <View style={[s.corner, s.bl, { borderColor: bracket }]} />
            <View style={[s.corner, s.br, { borderColor: bracket }]} />
          </View>
          {!done && (
            <Text pointerEvents="none" style={[s.hint, { top: winY + winH + 12 }]}>
              {pcMode ? (pc ? 'Align the barcode inside the frame' : 'Scan the QR code on your PC') : cur.hint}
            </Text>
          )}
        </>
      ) : (
        <Pressable style={[s.sleep, { top: top + barsH, height: pcMode ? undefined : Math.max(160, panelTop - top - barsH), bottom: pcMode ? 0 : undefined }]} onPress={wake}>
          <Image source={require('./assets/mark.png')} style={s.bigMark} />
          <Text style={s.muted}>Tap to scan</Text>
        </Pressable>
      )}

      {/* top bar: status / menu · brand · torch */}
      <View style={[s.topBar, { top }]}>
        <Pressable style={s.glass} onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="Menu and connection">
          <View style={[s.ring, { backgroundColor: dot + '33' }]}><View style={[s.dot, { backgroundColor: dot }]} /></View>
        </Pressable>
        <View style={s.brand} pointerEvents="none">
          <Image source={require('./assets/mark.png')} style={s.mark} />
          {!pcMode && !!session && <Text style={s.shop} numberOfLines={1}>{session.storeName || hostOf(session.url)}{admin ? '' : ' · Employee'}</Text>}
        </View>
        <Pressable style={[s.glass, torch && { backgroundColor: C.cyan }]} onPress={() => { setTorch((t) => !t); touch(); }} hitSlop={10} accessibilityLabel="Torch">
          <Image source={require('./assets/bolt.png')} style={[s.bolt, { tintColor: torch ? C.bg : '#fff' }]} />
        </Pressable>
      </View>

      {/* what a scan does */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.modes, { top: top + 56 }]} contentContainerStyle={s.modesIn} keyboardShouldPersistTaps="handled">
        {modes.map((x) => {
          const on = x.m === mode;
          return (
            <Pressable key={x.m} onPress={() => { if (!on) { feedback('select'); setMode(x.m); setResult(null); try { cam.current?.resumePreview(); } catch {} } touch(); }}
              style={[s.chip, on && { backgroundColor: x.color + '2A', borderColor: x.color }]} accessibilityState={{ selected: on }}>
              <View style={[s.chipDot, { backgroundColor: x.color }]} />
              <Text style={[s.chipText, on && { color: '#fff' }]}>{x.label}</Text>
            </Pressable>
          );
        })}
        {!session && (
          <Pressable onPress={() => setSetup(true)} style={[s.chip, { borderColor: 'rgba(127,233,254,0.5)' }]}>
            <Text style={[s.chipText, { color: C.cyan }]}>Sign in to save stock</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* stock modes: the result of the last scan, then the recent activity */}
      {!pcMode && (
        <>
          <View style={[s.strip, { top: stripY, left: 14, right: 14 }]} pointerEvents="none">
            <Strip flash={flash} dup={showDup} mode={cur} pending={stock.pending} admin={admin} />
          </View>
          <View style={[s.panel, { top: panelTop, paddingBottom: insets.bottom }]}>
            {session ? (
              <Activity groups={stock.groups} canUndo={stock.canUndo} onUndo={(e) => { stock.undo(e); touch(); }} onRetry={stock.retry} onDismiss={stock.dismissFailed}
                onRefresh={stock.refresh} loading={stock.loadingList} admin={admin} unsent={stock.unsent} />
            ) : (
              <View style={{ padding: 22 }}>
                <Text style={s.h2}>Save stock from this phone</Text>
                <Text style={s.mutedLeft}>Sign in to your TrackPad website to book Stock Out, Stock In and Return with every scan.</Text>
                <Pressable style={[s.btn, { marginTop: 16 }]} onPress={() => setSetup(true)}><Text style={s.btnText}>Sign in</Text></Pressable>
              </View>
            )}
          </View>
        </>
      )}

      {!!note && <View style={s.toast} pointerEvents="none"><Text style={s.toastText}>{note}</Text></View>}

      {/* PC mode: the result of one scan */}
      {done && (
        <Animated.View style={[s.sheet, { paddingBottom: 34 + insets.bottom, opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
          <Animated.View style={[s.checkCircle, { transform: [{ scale: pop }] }]}><View style={s.check} /></Animated.View>
          <Text style={s.h1}>1 item scanned</Text>
          <Text style={[s.status, { color: line.c }]}>{line.t}</Text>
          <Pressable style={[s.btn, { alignSelf: 'stretch' }]} onPress={scanNext}><Text style={s.btnText}>Scan next</Text></Pressable>
        </Animated.View>
      )}

      {adding && session && (
        <AddStockSheet api={server.api} serverUrl={session.url} target={adding}
          onClose={() => { setAdding(null); seen.current.clear(); touch(); }}
          onDone={(r, productId) => stock.added(r, productId)} />
      )}

      {menu && (
        <Menu session={session} net={stock.net} guard={guard} onGuard={changeGuard} sound={sound} onSound={changeSound}
          pc={pc} pcStatus={status} onReconnectPC={reconnect} onForgetPC={forget}
          onPairPC={() => { wake(); say('Point the camera at the QR code on TrackPad Desktop'); }}
          onSignIn={() => setSetup(true)} onSignOut={() => { server.signOut(); }} onClose={() => { setMenu(false); touch(); }} />
      )}
    </View>
  );
}

/** −1 · item · Stock Out · batch — the answer to the last scan, always the same height so nothing jumps */
function Strip({ flash, dup, mode, pending, admin }) {
  if (dup) {
    return (
      <View style={[s.stripBox, { borderColor: 'rgba(255,181,71,0.55)' }]}>
        <Text style={[s.stripTitle, { color: C.amber }]} numberOfLines={1}>Same label: counted once</Text>
        <Text style={s.stripSub} numberOfLines={1}>Next unit: take this one out of the frame, then show the next.</Text>
      </View>
    );
  }
  if (!flash) {
    return (
      <View style={[s.stripBox, s.stripIdle]}>
        <Text style={s.stripIdleText} numberOfLines={1}>{pending ? `Saving ${pending}…` : `Ready · ${mode.label}`}</Text>
      </View>
    );
  }
  const t = TYPES[flash.type] || TYPES.OUT;
  const failed = flash.state === 'failed';
  const color = failed ? C.red : flash.undone ? C.amber : t.color;
  const sub = failed
    ? flash.msg
    : flash.undone
      ? flash.msg
      : `${t.label} · ${flash.adjusted || flash.batchNo || ''}${flash.state === 'saving' ? ' · saving…' : admin && typeof flash.left === 'number' ? ` · ${flash.left} left` : ' · saved'}${flash.low ? ' · low stock' : ''}${pending > 1 ? ` · ${pending - 1} more saving` : ''}`;
  return (
    <View style={[s.stripBox, { borderColor: color + '88', backgroundColor: 'rgba(10,15,26,0.92)' }]}>
      <View style={s.stripRow}>
        {!failed && !flash.undone && <Text style={[s.stripSign, { color }]}>{t.sign}1</Text>}
        <Text style={[s.stripTitle, { color: failed ? C.red : '#fff', flex: 1 }]} numberOfLines={1}>{failed ? `${flash.empty ? 'Stock 0' : 'Not saved'} · ${flash.name || ''}` : flash.name}</Text>
        {flash.state === 'saving' && <ActivityIndicator size="small" color={C.muted} />}
      </View>
      <Text style={[s.stripSub, failed && { color: '#FFC2C6' }]} numberOfLines={2}>{sub}</Text>
    </View>
  );
}

const CORNER = 34;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  scrim: { position: 'absolute', backgroundColor: C.scrim },
  h1: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: 0.2 },
  h2: { color: '#fff', fontSize: 18, fontWeight: '800' },
  muted: { color: C.muted, fontSize: 15, marginTop: 8, textAlign: 'center' },
  mutedLeft: { color: C.muted, fontSize: 14, marginTop: 6, lineHeight: 20 },
  bigMark: { width: 86, height: 90, marginBottom: 22 },
  sleep: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },

  topBar: { position: 'absolute', left: 16, right: 16, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  glass: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.glass, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  mark: { width: 28, height: 30 },
  shop: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, fontWeight: '700', marginTop: 2, maxWidth: 200 },
  bolt: { width: 22, height: 22 },

  modes: { position: 'absolute', left: 0, right: 0, height: 44 },
  modesIn: { paddingHorizontal: 12, gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: 20, backgroundColor: C.glass, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)' },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { color: 'rgba(255,255,255,0.78)', fontSize: 13.5, fontWeight: '800' },

  corner: { position: 'absolute', width: CORNER, height: CORNER },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
  hint: { position: 'absolute', left: 16, right: 16, textAlign: 'center', color: 'rgba(255,255,255,0.8)', fontSize: 13.5, fontWeight: '600' },

  strip: { position: 'absolute', height: 64 },
  stripBox: { flex: 1, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: 'rgba(10,15,26,0.92)' },
  stripIdle: { borderColor: 'rgba(255,255,255,0.10)', borderStyle: 'dashed', alignItems: 'center', backgroundColor: 'rgba(10,15,26,0.55)' },
  stripIdleText: { color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '700' },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stripSign: { fontSize: 22, fontWeight: '900' },
  stripTitle: { fontSize: 16, fontWeight: '800' },
  stripSub: { color: C.muted, fontSize: 12.5, marginTop: 1 },

  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: C.line },

  toast: { position: 'absolute', alignSelf: 'center', top: '46%', backgroundColor: 'rgba(12,17,27,0.92)', paddingHorizontal: 22, paddingVertical: 13, borderRadius: 18, maxWidth: '86%' },
  toastText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.panel, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 26, paddingHorizontal: 22, alignItems: 'center' },
  checkCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(43,227,139,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  check: { width: 15, height: 28, borderRightWidth: 5, borderBottomWidth: 5, borderColor: C.green, transform: [{ rotate: '45deg' }, { translateY: -3 }], borderRadius: 2 },
  status: { fontSize: 15, fontWeight: '600', marginTop: 6, marginBottom: 22 },
  btn: { backgroundColor: C.cyan, borderRadius: 18, height: 60, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: C.bg, fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
});
