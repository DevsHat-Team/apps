import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';
import { hostOf } from './server';

export const GUARDS = [500, 750, 1000, 2000];
const VERSION = '1.2.3';

/** ⋯ : the account, the same-label wait, sound, the PC, sign out */
export function Menu({ session, net, guard, onGuard, sound, onSound, pc, pcStatus, onPairPC, onForgetPC, onReconnectPC, onSignIn, onSignOut, onClose }) {
  const insets = useSafeAreaInsets();
  const next = GUARDS[(GUARDS.indexOf(guard) + 1) % GUARDS.length] ?? 1000;
  const sec = (ms) => `${ms / 1000} s`.replace('.', '.');

  const confirmSignOut = () => Alert.alert('Sign out?', 'Scans then go nowhere until you sign in again (or pick To PC).', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => { onClose(); onSignOut(); } },
  ]);
  const confirmForget = () => Alert.alert('Forget this PC?', 'To use it again, scan the QR code on TrackPad Desktop.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Forget', style: 'destructive', onPress: onForgetPC },
  ]);

  const netText = { ok: 'Connected', retrying: 'Weak connection, sending again…', offline: 'No connection right now' }[net] || 'Connected';
  const netColor = net === 'ok' ? C.green : net === 'retrying' ? C.amber : C.red;
  const pcText = { connected: 'Connected', connecting: 'Looking for the PC…', offline: 'PC not found (same Wi-Fi? TrackPad Desktop open?)', idle: 'Not paired' }[pcStatus] || '';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={s.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
          <View style={s.grip} />
          <ScrollView>
            <Text style={s.h}>TrackPad website</Text>
            {session ? (
              <View style={s.card}>
                <Text style={s.big}>{session.storeName || hostOf(session.url)}</Text>
                <Text style={s.sub}>{hostOf(session.url)}</Text>
                <Text style={s.sub}>Signed in as <Text style={s.b}>{session.role === 'admin' ? 'Admin' : 'Employee'}</Text></Text>
                <View style={s.stat}><View style={[s.dot, { backgroundColor: netColor }]} /><Text style={s.statText}>{netText}</Text></View>
                <View style={s.rowBtns}>
                  <Pressable style={s.small} onPress={() => { onClose(); onSignIn(); }}><Text style={s.smallText}>Switch account</Text></Pressable>
                  <Pressable style={s.small} onPress={confirmSignOut}><Text style={[s.smallText, { color: C.red }]}>Sign out</Text></Pressable>
                </View>
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.sub}>Sign in to save Stock Out, Stock In, Return and new stock straight from this phone.</Text>
                <Pressable style={s.btn} onPress={() => { onClose(); onSignIn(); }}><Text style={s.btnText}>Sign in</Text></Pressable>
              </View>
            )}

            <Text style={s.h}>Scanning</Text>
            <Pressable style={s.item} onPress={() => onGuard(next)}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemTitle}>Same label wait: {sec(guard)}</Text>
                <Text style={s.sub}>A label counts again once it left the frame and this time has passed. Tap to change (next: {sec(next)}).</Text>
              </View>
            </Pressable>
            <Pressable style={s.item} onPress={() => onSound(!sound)}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemTitle}>Beep: {sound ? 'on' : 'off'}</Text>
                <Text style={s.sub}>A short beep for every scan, a low double beep when it is not saved. Silent mode stays silent.</Text>
              </View>
              <View style={[s.toggle, sound && s.toggleOn]}><View style={[s.knob, sound && s.knobOn]} /></View>
            </Pressable>

            <Text style={s.h}>PC (TrackPad Desktop)</Text>
            <View style={s.card}>
              <Text style={s.sub}>{pc ? `PC: ${pcText}` : 'Pair a PC to send scans to its Scan station (“To PC”).'}</Text>
              <View style={s.rowBtns}>
                {pc && pcStatus !== 'connected' && <Pressable style={s.small} onPress={onReconnectPC}><Text style={s.smallText}>Reconnect</Text></Pressable>}
                <Pressable style={s.small} onPress={() => { onClose(); onPairPC(); }}><Text style={s.smallText}>{pc ? 'Pair another PC' : 'Scan the PC’s QR code'}</Text></Pressable>
                {pc && <Pressable style={s.small} onPress={confirmForget}><Text style={[s.smallText, { color: C.red }]}>Forget PC</Text></Pressable>}
              </View>
            </View>
            <Text style={s.version}>TrackPad Mobile {VERSION}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: C.panel, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, maxHeight: '88%' },
  grip: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(143,155,194,0.4)', marginBottom: 6 },
  h: { color: C.muted, fontSize: 12.5, fontWeight: '800', marginTop: 16, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: C.panel2, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: C.line },
  big: { color: C.text, fontSize: 17, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  b: { color: C.text, fontWeight: '800' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statText: { color: C.sub, fontSize: 13, fontWeight: '600' },
  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  small: { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, height: 38, justifyContent: 'center' },
  smallText: { color: C.cyan, fontWeight: '700', fontSize: 13.5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel2, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 8 },
  itemTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  toggle: { width: 46, height: 28, borderRadius: 14, backgroundColor: 'rgba(143,155,194,0.3)', padding: 3 },
  toggleOn: { backgroundColor: C.cyan },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  knobOn: { transform: [{ translateX: 18 }] },
  btn: { backgroundColor: C.cyan, borderRadius: 15, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnText: { color: C.bg, fontSize: 16, fontWeight: '800' },
  version: { color: C.muted, fontSize: 11.5, textAlign: 'center', marginTop: 18, marginBottom: 4 },
});
