import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C } from './theme';
import { WEB_QR, readWebQR } from './server';
import { QR_PREFIX } from './usePC';
import { feedback } from './feedback';

const LAST = 'trackpad.lastAddress';

/**
 * Connect the phone: sign in to the TrackPad website (stock is saved from the phone),
 * or pair TrackPad Desktop on a PC (the phone only sends the scanned numbers to the PC, as before).
 */
export function Setup({ signIn, pair, why, onCancel, pcPaired, initialAddress = '' }) {
  const insets = useSafeAreaInsets();
  const [address, setAddress] = useState(initialAddress);
  const [role, setRole] = useState('admin');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [qr, setQr] = useState(false);

  useEffect(() => { AsyncStorage.getItem(LAST).then((v) => v && setAddress((a) => a || v)).catch(() => {}); }, []);

  async function go() {
    if (busy) return;
    setErr('');
    if (!address.trim()) { setErr('Enter the website address.'); return; }
    if (!password) { setErr('Enter the password.'); return; }
    setBusy(true);
    try {
      const s = await signIn(address, password, role);
      AsyncStorage.setItem(LAST, s.url).catch(() => {});
      feedback('ok');
    } catch (e) {
      setErr(e.message);
      feedback('error');
      setBusy(false);
    }
  }

  const onQR = (text) => {
    setQr(false);
    if (text.startsWith(WEB_QR)) {
      const url = readWebQR(text);
      if (url) { setAddress(url); setErr(''); feedback('ok'); } else { setErr('This QR code is not readable. Type the address instead.'); feedback('error'); }
    } else if (text.startsWith(QR_PREFIX)) {
      if (pair(text)) feedback('ok'); else { setErr('This PC code is not valid. Show it again on the PC.'); feedback('error'); }
    } else {
      setErr('That is not a TrackPad QR code. Open TrackPad → Settings → Setup guide → Phone app on the PC.');
      feedback('error');
    }
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.body, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}>
          {onCancel && (
            <Pressable onPress={onCancel} hitSlop={12} style={s.back}><Text style={s.backText}>‹ Back to scanning</Text></Pressable>
          )}
          <Image source={require('../assets/mark.png')} style={s.mark} />
          <Text style={s.h1}>Save stock from this phone</Text>
          <Text style={s.lead}>Sign in to your TrackPad website once. Then every scan books Stock Out, Stock In or Return straight away, and the admin can add new stock.</Text>

          {!!why && <Text style={[s.err, s.whyBox]}>{why}</Text>}

          <Pressable style={s.qrBtn} onPress={() => setQr(true)}>
            <View style={s.qrIcon}><View style={s.qrDot} /><View style={[s.qrDot, { right: 3, left: undefined }]} /><View style={[s.qrDot, { bottom: 3, top: undefined }]} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.qrTitle}>Scan the QR code</Text>
              <Text style={s.qrSub}>On the PC: TrackPad → Settings → Setup guide → Phone app. Fills in the address for you.</Text>
            </View>
          </Pressable>

          <Text style={s.label}>Website address</Text>
          <TextInput value={address} onChangeText={(t) => { setAddress(t); setErr(''); }} placeholder="my-shop.vercel.app" placeholderTextColor={C.muted}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} returnKeyType="next" />

          <Text style={s.label}>Account</Text>
          <View style={s.seg}>
            {[['admin', 'Admin'], ['employee', 'Employee']].map(([k, t]) => (
              <Pressable key={k} onPress={() => { setRole(k); setErr(''); }} style={[s.segBtn, role === k && s.segOn]}>
                <Text style={[s.segText, role === k && s.segTextOn]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.small}>{role === 'admin' ? 'Admin: Stock Out, Stock In, Return and Add new stock, with the stock numbers.' : 'Employee: Stock Out, Stock In and Return, one unit per scan. Undo own scans for 15 minutes.'}</Text>

          <Text style={s.label}>Password</Text>
          <View>
            <TextInput value={password} onChangeText={(t) => { setPassword(t); setErr(''); }} secureTextEntry={!show} placeholder={role === 'admin' ? 'Admin password' : 'Employee password'}
              placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} style={[s.input, { paddingRight: 70 }]} returnKeyType="go" onSubmitEditing={go} />
            <Pressable onPress={() => setShow((v) => !v)} style={s.eye} hitSlop={8}><Text style={s.eyeText}>{show ? 'Hide' : 'Show'}</Text></Pressable>
          </View>

          {!!err && <Text style={[s.err, { marginTop: 14 }]}>{err}</Text>}
          <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={go} disabled={busy}>
            {busy ? <ActivityIndicator color={C.bg} /> : <Text style={s.btnText}>Sign in</Text>}
          </Pressable>

          <View style={s.or}><View style={s.rule} /><Text style={s.orText}>or</Text><View style={s.rule} /></View>
          <Text style={s.pcTitle}>{pcPaired ? 'Your PC is paired' : 'Only send scans to a PC'}</Text>
          <Text style={s.small}>{pcPaired
            ? 'Go back to scanning and pick “To PC” to type scans into the PC’s Scan station, as before.'
            : 'With TrackPad Desktop on the PC: scan the QR code it shows. The scans are typed into the Scan station on the PC.'}</Text>
          {!pcPaired && (
            <Pressable style={[s.btn, s.btnGhost]} onPress={() => setQr(true)}><Text style={[s.btnText, { color: C.cyan }]}>Scan the PC’s QR code</Text></Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {qr && <QRReader onRead={onQR} onClose={() => setQr(false)} />}
    </View>
  );
}

function QRReader({ onRead, onClose }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [done, setDone] = useState(false);
  useEffect(() => { if (permission && !permission.granted && permission.canAskAgain) requestPermission(); }, [permission]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[s.root, { justifyContent: 'center' }]}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" autofocus="on" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={done ? undefined : ({ data }) => { if (!data) return; setDone(true); onRead(String(data)); }} />
        ) : (
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text style={s.lead}>TrackPad needs the camera to read the QR code.</Text>
            {permission && !permission.canAskAgain && (
              <Pressable style={[s.btn, { alignSelf: 'stretch' }]} onPress={() => Linking.openSettings()}><Text style={s.btnText}>Open settings</Text></Pressable>
            )}
          </View>
        )}
        {permission?.granted && <View pointerEvents="none" style={s.qrFrame} />}
        <Text pointerEvents="none" style={[s.qrHint, { bottom: insets.bottom + 110 }]}>Point the camera at the TrackPad QR code</Text>
        <Pressable onPress={onClose} style={[s.btn, s.btnGhost, { position: 'absolute', left: 24, right: 24, bottom: insets.bottom + 28, backgroundColor: C.glass }]}>
          <Text style={[s.btnText, { color: '#fff' }]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { paddingHorizontal: 24 },
  back: { alignSelf: 'flex-start', marginBottom: 18 },
  backText: { color: C.cyan, fontSize: 15, fontWeight: '700' },
  mark: { width: 54, height: 57, marginBottom: 18 },
  h1: { color: C.text, fontSize: 27, fontWeight: '800', letterSpacing: 0.2 },
  lead: { color: C.muted, fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: 'left' },
  whyBox: { marginTop: 16, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,92,102,0.1)', borderWidth: 1, borderColor: 'rgba(255,92,102,0.35)' },
  qrBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 22, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(127,233,254,0.45)', backgroundColor: 'rgba(127,233,254,0.06)' },
  qrIcon: { width: 40, height: 40, borderRadius: 8, borderWidth: 2, borderColor: C.cyan },
  qrDot: { position: 'absolute', top: 3, left: 3, width: 11, height: 11, borderRadius: 2, backgroundColor: C.cyan },
  qrTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  qrSub: { color: C.muted, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  label: { color: C.sub, fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  input: { height: 54, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2, color: C.text, fontSize: 16, paddingHorizontal: 15 },
  eye: { position: 'absolute', right: 8, top: 8, height: 38, paddingHorizontal: 10, justifyContent: 'center' },
  eyeText: { color: C.cyan, fontWeight: '700' },
  seg: { flexDirection: 'row', backgroundColor: C.panel2, borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.cyan },
  segText: { color: C.sub, fontWeight: '700', fontSize: 15 },
  segTextOn: { color: C.bg },
  small: { color: C.muted, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  err: { color: C.red, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  btn: { backgroundColor: C.cyan, borderRadius: 17, height: 58, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(127,233,254,0.5)' },
  btnText: { color: C.bg, fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 30, marginBottom: 14 },
  rule: { flex: 1, height: 1, backgroundColor: C.line },
  orText: { color: C.muted, fontSize: 13 },
  pcTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  qrFrame: { position: 'absolute', alignSelf: 'center', width: 240, height: 240, borderRadius: 26, borderWidth: 3, borderColor: C.cyan },
  qrHint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '600' },
});
