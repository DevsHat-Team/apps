import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { QR_PREFIX, usePC } from './src/usePC';

const BARCODE_TYPES = [
  'qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93',
  'codabar', 'itf14', 'datamatrix', 'pdf417', 'aztec',
];
const LABELS = {
  qr: 'QR Code', ean13: 'EAN-13', ean8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E',
  code128: 'Code 128', code39: 'Code 39', code93: 'Code 93', codabar: 'Codabar',
  itf14: 'ITF-14', datamatrix: 'Data Matrix', pdf417: 'PDF417', aztec: 'Aztec',
};
const COLORS = { ok: '#22C55E', warn: '#F59E0B', bad: '#F87171', accent: '#22D3EE', bg: '#0B1020' };

export default function App() {
  useKeepAwake();
  const [permission, requestPermission] = useCameraPermissions();
  const { pc, status, loaded, pair, forget, send, reconnect } = usePC();
  const [result, setResult] = useState(null); // { id, code, type, state }
  const [toast, setToast] = useState('');
  const [torch, setTorch] = useState(false);
  const lock = useRef(false); // blocks duplicate reads while a result is on screen

  const flashToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => { setToast(''); lock.current = false; }, 1500);
  }, []);

  const onScan = useCallback(({ data, type }) => {
    if (lock.current || !data) return;
    lock.current = true;

    // The PC app's pairing QR connects the phone
    if (data.startsWith(QR_PREFIX)) {
      const name = pair(data);
      Haptics.notificationAsync(
        name ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
      );
      flashToast(name ? `Connected to ${name}` : 'Not a valid Trackpad code');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (!pc) {
      setResult({ id, code: data, type, state: 'nopc' });
      return;
    }
    setResult({ id, code: data, type, state: 'sending' }); // show instantly, deliver in background
    send(id, data, type).then((state) =>
      setResult((r) => (r && r.id === id ? { ...r, state } : r))
    );
  }, [pc, pair, send, flashToast]);

  const scanAgain = useCallback(() => {
    Haptics.selectionAsync();
    setResult(null);
    lock.current = false;
  }, []);

  const onPillPress = () => {
    const buttons = [{ text: 'Close', style: 'cancel' }];
    if (pc) {
      buttons.unshift({ text: 'Forget this PC', style: 'destructive', onPress: forget });
      if (status !== 'connected') buttons.unshift({ text: 'Reconnect', onPress: reconnect });
    }
    Alert.alert(
      pc ? pc.n : 'Not connected',
      pc
        ? 'Make sure this phone and the PC are on the same Wi-Fi.'
        : 'Open Trackpad on your PC and scan the QR code shown there.',
      buttons
    );
  };

  // ---------- permission screens ----------
  if (!permission || !loaded) return <View style={styles.root} />;
  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" />
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.muted}>Trackpad uses the camera only to read barcodes.</Text>
        <Pressable
          style={styles.bigBtn}
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
        >
          <Text style={styles.bigBtnText}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text>
        </Pressable>
      </View>
    );
  }

  // ---------- status pill ----------
  const pill =
    status === 'connected'
      ? { color: COLORS.ok, text: pc.n }
      : status === 'connecting'
      ? { color: COLORS.warn, text: 'Connecting…' }
      : status === 'offline'
      ? { color: COLORS.bad, text: `${pc.n} offline` }
      : { color: COLORS.bad, text: 'Scan PC code to connect' };

  const stateInfo = result && {
    sending: { color: COLORS.warn, text: `Sending to ${pc ? pc.n : 'PC'}…` },
    sent: { color: COLORS.ok, text: `✓ Sent to ${pc ? pc.n : 'PC'}` },
    failed: { color: COLORS.bad, text: '✕ Not delivered - check the PC app and Wi-Fi' },
    nopc: { color: COLORS.warn, text: 'Not connected - scan the QR in the PC app' },
  }[result.state];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={result || toast ? undefined : onScan}
      />

      {/* viewfinder */}
      {!result && (
        <View style={styles.finderWrap} pointerEvents="none">
          <View style={styles.finder}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
          <Text style={styles.hint}>
            {pc ? 'Point at a barcode' : 'Scan the QR code in the Trackpad PC app'}
          </Text>
        </View>
      )}

      {/* top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.pill} onPress={onPillPress}>
          <View style={[styles.dot, { backgroundColor: pill.color }]} />
          <Text style={styles.pillText} numberOfLines={1}>{pill.text}</Text>
        </Pressable>
        <Pressable style={[styles.roundBtn, torch && styles.roundBtnOn]} onPress={() => setTorch((t) => !t)}>
          <Text style={styles.roundBtnText}>{torch ? 'Flash on' : 'Flash'}</Text>
        </Pressable>
      </View>

      {!!toast && (
        <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>
      )}

      {/* result sheet */}
      {result && (
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>{LABELS[result.type] || 'Scanned'}</Text>
          <Text style={styles.code} selectable numberOfLines={4}>{result.code}</Text>
          <Text style={[styles.state, { color: stateInfo.color }]}>{stateInfo.text}</Text>
          <Pressable style={styles.bigBtn} onPress={scanAgain}>
            <Text style={styles.bigBtnText}>Scan again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const CORNER = 34;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  muted: { color: '#8F9BC2', fontSize: 14, textAlign: 'center' },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 52, paddingHorizontal: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '68%',
    backgroundColor: 'rgba(11,16,32,0.78)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  roundBtn: { backgroundColor: 'rgba(11,16,32,0.78)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  roundBtnOn: { backgroundColor: COLORS.accent },
  roundBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  finderWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  finder: { width: 290, height: 210 },
  hint: { marginTop: 22, color: '#fff', fontSize: 15, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 6 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: COLORS.accent },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },

  toast: {
    position: 'absolute', alignSelf: 'center', top: '45%',
    backgroundColor: 'rgba(11,16,32,0.92)', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16,
  },
  toastText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    padding: 22, paddingBottom: 36, gap: 8,
  },
  sheetLabel: { color: '#8F9BC2', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  code: { color: '#fff', fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  state: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  bigBtn: {
    backgroundColor: COLORS.accent, borderRadius: 16, paddingVertical: 17, alignItems: 'center', alignSelf: 'stretch',
  },
  bigBtnText: { color: '#06101F', fontSize: 18, fontWeight: '800' },
});
