import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, AppState, Image, Linking, Platform, Pressable,
  StatusBar, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { QR_PREFIX, usePC } from './src/usePC';

// Fewer formats = faster decoding and a cooler phone. Covers shops, warehouses and QR.
const FORMATS = ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'];
const IDLE_SLEEP_MS = 45000; // camera switches off when nobody scans (saves heat + battery)

const C = {
  bg: '#05070D', cyan: '#7FE9FE', green: '#2BE38B', red: '#FF5C66',
  amber: '#FFB547', glass: 'rgba(12,17,27,0.72)', scrim: 'rgba(3,5,9,0.64)',
};
const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 10 : 58;

export default function App() {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const { pc, status, loaded, pair, forget, send, reconnect } = usePC();

  const [result, setResult] = useState(null); // { id, state }
  const [toast, setToast] = useState('');
  const [torch, setTorch] = useState(false);
  const [awake, setAwake] = useState(true);

  const cam = useRef(null);
  const lock = useRef(false);
  const idle = useRef(null);
  const pop = useRef(new Animated.Value(0)).current;

  // ----- sleep the camera after a quiet minute -----
  const touch = useCallback(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setAwake(false), IDLE_SLEEP_MS);
  }, []);
  useEffect(() => {
    touch();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { setAwake(true); touch(); }
    });
    return () => { sub.remove(); clearTimeout(idle.current); };
  }, [touch]);
  useEffect(() => {
    if (awake) activateKeepAwakeAsync('scan').catch(() => {});
    else { deactivateKeepAwake('scan'); setTorch(false); }
  }, [awake]);

  const wake = () => {
    lock.current = false;
    setResult(null);
    pop.setValue(0);
    setAwake(true);
    touch();
  };

  // ----- scanning -----
  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => { setToast(''); lock.current = false; }, 1400);
  }, []);

  const onScan = useCallback(({ data }) => {
    if (lock.current || !data) return;
    lock.current = true;
    touch();

    if (data.startsWith(QR_PREFIX)) { // PC pairing code
      const ok = pair(data);
      Haptics.notificationAsync(
        ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
      );
      flash(ok ? 'Connected' : 'Invalid code');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { cam.current?.pausePreview(); } catch {}
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setResult({ id, state: pc ? 'sending' : 'nopc' });
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 7, tension: 120 }).start();
    if (pc) {
      send(id, data, 'scan').then((state) =>
        setResult((r) => (r && r.id === id ? { ...r, state } : r))
      );
    }
  }, [pc, pair, send, flash, touch, pop]);

  const scanNext = useCallback(() => {
    Haptics.selectionAsync();
    try { cam.current?.resumePreview(); } catch {}
    setResult(null);
    pop.setValue(0);
    lock.current = false;
    touch();
  }, [pop, touch]);

  const onDotPress = () => {
    const buttons = [{ text: 'Close', style: 'cancel' }];
    if (pc) {
      buttons.unshift({ text: 'Forget this PC', style: 'destructive', onPress: forget });
      if (status !== 'connected') buttons.unshift({ text: 'Reconnect', onPress: reconnect });
    }
    Alert.alert(
      'TrackPad',
      status === 'connected'
        ? 'Connected to your PC.'
        : pc
        ? 'PC not found. Make sure TrackPad is running on the PC and both are on the same Wi-Fi.'
        : 'Open TrackPad on your PC and scan the QR code shown there.',
      buttons
    );
  };

  // ----- permission -----
  if (!permission || !loaded) return <View style={s.root} />;
  if (!permission.granted) {
    return (
      <View style={[s.root, s.center]}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Image source={require('./assets/mark.png')} style={s.bigMark} />
        <Text style={s.h1}>Camera access</Text>
        <Text style={s.muted}>TrackPad needs the camera to read barcodes.</Text>
        <Pressable
          style={[s.btn, { alignSelf: 'stretch', marginTop: 24 }]}
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
        >
          <Text style={s.btnText}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text>
        </Pressable>
      </View>
    );
  }

  // ----- layout -----
  const winW = Math.min(width * 0.86, 360);
  const winH = Math.round(winW * 0.6);
  const winX = Math.round((width - winW) / 2);
  const winY = Math.round(height * 0.38 - winH / 2);
  const done = !!result;
  const bracket = done ? C.green : C.cyan;
  const dot = status === 'connected' ? C.green : C.red;

  const line = result && {
    sending: { c: '#8F9BC2', t: 'Sending…' },
    sent: { c: C.green, t: 'Sent to PC' },
    failed: { c: C.red, t: "Couldn't reach your PC" },
    nopc: { c: C.amber, t: 'Connect a PC first' },
  }[result.state];

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
          onBarcodeScanned={done || toast ? undefined : onScan}
        />
      )}

      {awake && (
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
            <Text pointerEvents="none" style={[s.hint, { top: winY + winH + 20 }]}>
              {pc ? 'Align the barcode inside the frame' : 'Scan the QR code on your PC'}
            </Text>
          )}

          {/* top bar: status dot · brand mark · flash */}
          <View style={s.topBar}>
            <Pressable style={s.glass} onPress={onDotPress} hitSlop={10}>
              <View style={[s.ring, { backgroundColor: dot + '33' }]}>
                <View style={[s.dot, { backgroundColor: dot }]} />
              </View>
            </Pressable>
            <Image source={require('./assets/mark.png')} style={s.mark} />
            <Pressable
              style={[s.glass, torch && { backgroundColor: C.cyan }]}
              onPress={() => { setTorch((t) => !t); touch(); }}
              hitSlop={10}
            >
              <Image source={require('./assets/bolt.png')} style={[s.bolt, { tintColor: torch ? C.bg : '#fff' }]} />
            </Pressable>
          </View>

          {!!toast && (
            <View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>
          )}

          {/* result */}
          {done && (
            <Animated.View
              style={[s.sheet, { opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}
            >
              <Animated.View style={[s.checkCircle, { transform: [{ scale: pop }] }]}>
                <View style={s.check} />
              </Animated.View>
              <Text style={s.h1}>1 item scanned</Text>
              <Text style={[s.status, { color: line.c }]}>{line.t}</Text>
              <Pressable style={s.btn} onPress={scanNext}>
                <Text style={s.btnText}>Scan next</Text>
              </Pressable>
            </Animated.View>
          )}
        </>
      )}

      {/* sleeping screen */}
      {!awake && (
        <Pressable style={[StyleSheet.absoluteFill, s.center]} onPress={wake}>
          <Image source={require('./assets/mark.png')} style={s.bigMark} />
          <Text style={s.muted}>Tap to scan</Text>
        </Pressable>
      )}
    </View>
  );
}

const CORNER = 38;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  scrim: { position: 'absolute', backgroundColor: C.scrim },
  h1: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: 0.2 },
  muted: { color: '#8F9BC2', fontSize: 15, marginTop: 8, textAlign: 'center' },
  bigMark: { width: 86, height: 90, marginBottom: 22 },

  topBar: {
    position: 'absolute', top: TOP, left: 18, right: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  glass: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: C.glass,
    alignItems: 'center', justifyContent: 'center',
  },
  ring: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  mark: { width: 32, height: 34 },
  bolt: { width: 22, height: 22 },

  corner: { position: 'absolute', width: CORNER, height: CORNER },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  hint: { position: "absolute", left: 0, right: 0, textAlign: "center", color: 'rgba(255,255,255,0.78)', fontSize: 14, fontWeight: '600' },

  toast: {
    position: 'absolute', alignSelf: 'center', top: '58%',
    backgroundColor: C.glass, paddingHorizontal: 26, paddingVertical: 14, borderRadius: 18,
  },
  toastText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#0A0F1A', borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingTop: 26, paddingHorizontal: 22, paddingBottom: 34, alignItems: 'center',
  },
  checkCircle: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(43,227,139,0.16)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  check: {
    width: 15, height: 28, borderRightWidth: 5, borderBottomWidth: 5, borderColor: C.green,
    transform: [{ rotate: '45deg' }, { translateY: -3 }], borderRadius: 2,
  },
  status: { fontSize: 15, fontWeight: '600', marginTop: 6, marginBottom: 22 },
  btn: {
    backgroundColor: C.cyan, borderRadius: 18, height: 62, alignSelf: 'stretch',
    alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: C.bg, fontSize: 19, fontWeight: '800', letterSpacing: 0.3 },
});
