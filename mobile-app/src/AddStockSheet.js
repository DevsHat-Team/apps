import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, MONO } from './theme';
import { feedback } from './feedback';

const fmtDate = (d) => {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  return `${t.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getMonth()]}`;
};

/**
 * Add new stock (admin), the same form as on the website: the scanned item → how many arrived → existing batch or a
 * new batch → save. Then the labels to print. Received goes up together with the stock.
 */
export function AddStockSheet({ api, serverUrl, target, onClose, onDone }) {
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [qty, setQty] = useState('');
  const [mode, setMode] = useState('existing');
  const [existing, setExisting] = useState('');
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [allBatches, setAllBatches] = useState(false);
  const qtyRef = useRef(null);

  const load = async () => {
    setLoadErr('');
    setInfo(null);
    try {
      const r = await api('GET', `/api/stock-add?productId=${encodeURIComponent(target.productId)}`, undefined, 20000);
      setInfo(r);
      const scanned = r.batches.find((b) => b.id === target.batchId);
      setExisting(scanned?.batchNo ?? r.batches[0]?.batchNo ?? r.recent[0] ?? '');
      setMode(r.batches.length || r.recent.length ? 'existing' : 'new');
      setNewName(r.suggested || '');
      setTimeout(() => qtyRef.current?.focus(), 250);
    } catch (e) {
      setLoadErr(e.message);
    }
  };
  useEffect(() => { load(); }, [target.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = parseInt(qty, 10) || 0;
  const batchNo = mode === 'existing' ? existing : newName.trim();
  const inBatch = info?.batches.find((b) => b.batchNo === batchNo);

  async function save() {
    if (!info || busy) return;
    if (n < 1) { setErr('Enter how many units arrived.'); qtyRef.current?.focus(); return; }
    if (!batchNo) { setErr(mode === 'existing' ? 'Choose a batch.' : 'Enter the new batch name.'); return; }
    setBusy(true);
    setErr('');
    const before = info.product.stock;
    const body = { productId: info.product.id, qty: n, batchNo, mode, note: note.trim() || null };
    try {
      const r = await api('POST', '/api/stock-add', body, 30000);
      finish(r);
    } catch (e) {
      if (!e.network) { setErr(e.message); feedback('error'); setBusy(false); return; }
      // no answer came back: look whether it was saved before offering to send it again (never add it twice)
      try {
        const now = await api('GET', `/api/stock-add?productId=${encodeURIComponent(info.product.id)}`, undefined, 20000);
        const b = now.batches.find((x) => x.batchNo === batchNo);
        if (now.product.stock === before + n && b) {
          finish({ productName: info.product.name, qty: n, before, after: now.product.stock, sameBarcode: !!inBatch, labelsUrl: `/labels?ids=${b.id}&copies=${n}`, batch: { id: b.id, batchNo: b.batchNo, barcode: b.barcode, stock: b.stock, received: b.received } });
          return;
        }
        setInfo(now);
        setErr('Not saved: the connection dropped. Check the internet and press Add again.');
      } catch {
        setErr('The connection dropped, so it is not clear if this was saved. Check the item on the website before adding it again.');
      }
      feedback('error');
    }
    setBusy(false);
  }
  function finish(r) {
    setBusy(false);
    setDone(r);
    feedback('ok');
    onDone(r, info.product.id);
  }

  const batchRows = info ? [
    ...info.batches.map((b) => ({ key: b.id, batchNo: b.batchNo, line: `${b.stock} in stock of ${b.received} · ${fmtDate(b.receivedAt)}`, own: true })),
    ...info.recent.map((b) => ({ key: `r-${b}`, batchNo: b, line: 'Other recent batch (this item is not in it yet)', own: false })),
  ] : [];
  const shown = allBatches ? batchRows : batchRows.slice(0, 5);

  let body;
  if (done) {
    body = (
      <View>
        <View style={[s.box, { borderColor: 'rgba(43,227,139,0.45)', backgroundColor: 'rgba(43,227,139,0.08)' }]}>
          <Text style={[s.boxTitle, { color: C.green }]}>Stock added</Text>
          <Text style={s.line}><Text style={s.b}>{done.qty}</Text> × {done.productName} → batch <Text style={[s.b, s.mono]}>{done.batch.batchNo}</Text></Text>
          <Text style={s.lineMuted}>Stock {done.before} → <Text style={s.b}>{done.after}</Text> · batch now {done.batch.stock} in stock of {done.batch.received} received</Text>
          <Text style={[s.lineMuted, { marginTop: 8 }]}>Labels: barcode <Text style={[s.b, s.mono]}>{done.batch.barcode}</Text>{done.sameBarcode ? ' — the same barcode as this item’s other labels in this batch.' : ' — a new barcode for this item in this batch.'}</Text>
        </View>
        <Text style={s.hint}>Print the labels on the PC: TrackPad → Labels → Stock added recently. Or open them here in the browser.</Text>
        <Pressable style={[s.btn, s.btnGhost]} onPress={() => Linking.openURL(serverUrl + done.labelsUrl).catch(() => {})}>
          <Text style={[s.btnText, { color: C.cyan }]}>Open {done.qty} label{done.qty === 1 ? '' : 's'} in the browser</Text>
        </Pressable>
        <Pressable style={s.btn} onPress={onClose}><Text style={s.btnText}>Scan next</Text></Pressable>
      </View>
    );
  } else if (loadErr) {
    body = (
      <View>
        <Text style={[s.err, { marginBottom: 16 }]}>{loadErr}</Text>
        <Pressable style={s.btn} onPress={load}><Text style={s.btnText}>Try again</Text></Pressable>
      </View>
    );
  } else if (!info) {
    body = <View style={s.loading}><ActivityIndicator color={C.cyan} /><Text style={s.lineMuted}>  Loading item</Text></View>;
  } else {
    body = (
      <View>
        <View style={s.box}>
          <Text style={s.item}>{info.product.name}{info.product.size ? ` · ${info.product.size}` : ''}</Text>
          <Text style={s.lineMuted}>{info.product.brandName}</Text>
          <Text style={[s.line, { marginTop: 10 }]}>Stock now: <Text style={s.big}>{info.product.stock}</Text>{n > 0 && <Text> → <Text style={[s.big, { color: C.green }]}>{info.product.stock + n}</Text></Text>}</Text>
        </View>

        <Text style={s.label}>How many units arrived?</Text>
        <View style={s.qtyRow}>
          <Pressable style={s.step} onPress={() => setQty(String(Math.max(0, n - 1) || ''))} hitSlop={6}><Text style={s.stepText}>−</Text></Pressable>
          <TextInput ref={qtyRef} value={qty} onChangeText={(t) => { setQty(t.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
            keyboardType="number-pad" placeholder="0" placeholderTextColor={C.muted} style={s.qty} returnKeyType="done" onSubmitEditing={save} />
          <Pressable style={s.step} onPress={() => setQty(String(Math.min(100000, n + 1)))} hitSlop={6}><Text style={s.stepText}>+</Text></Pressable>
        </View>

        <Text style={s.label}>Which batch?</Text>
        <View style={s.seg}>
          <Pressable disabled={!batchRows.length} onPress={() => setMode('existing')} style={[s.segBtn, mode === 'existing' && s.segOn, !batchRows.length && { opacity: 0.4 }]}>
            <Text style={[s.segText, mode === 'existing' && s.segTextOn]}>Existing batch</Text>
          </Pressable>
          <Pressable onPress={() => setMode('new')} style={[s.segBtn, mode === 'new' && s.segOn]}>
            <Text style={[s.segText, mode === 'new' && s.segTextOn]}>New batch</Text>
          </Pressable>
        </View>
        {mode === 'existing' ? (
          <View>
            {shown.map((b) => (
              <Pressable key={b.key} onPress={() => setExisting(b.batchNo)} style={[s.batch, existing === b.batchNo && s.batchOn]}>
                <View style={[s.radio, existing === b.batchNo && s.radioOn]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.batchNo, s.mono]}>{b.batchNo}</Text>
                  <Text style={s.lineMuted} numberOfLines={1}>{b.line}</Text>
                </View>
              </Pressable>
            ))}
            {batchRows.length > 5 && !allBatches && (
              <Pressable onPress={() => setAllBatches(true)} hitSlop={6}><Text style={s.link}>Show all {batchRows.length} batches</Text></Pressable>
            )}
            <Text style={s.hint}>{inBatch
              ? `Added to the same batch entry: received ${inBatch.received} → ${inBatch.received + n}. The labels keep the same barcode ${inBatch.barcode}.`
              : existing ? `This item is added to batch ${existing} with its own new barcode.` : ''}</Text>
          </View>
        ) : (
          <View>
            <TextInput value={newName} onChangeText={(t) => { setNewName(t); setErr(''); }} autoCapitalize="none" autoCorrect={false}
              placeholder="B1-oct-26" placeholderTextColor={C.muted} style={[s.input, s.mono]} />
            <Text style={s.hint}>A new batch: this item gets a new barcode, so you can tell this stock apart from older stock.</Text>
          </View>
        )}

        <Text style={s.label}>Note (optional)</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="e.g. supplier, invoice no." placeholderTextColor={C.muted} style={s.input} maxLength={200} />

        {!!err && <Text style={[s.err, { marginTop: 14 }]}>{err}</Text>}
        <Pressable disabled={busy || n < 1 || !batchNo} onPress={save} style={[s.btn, { marginTop: 18 }, (busy || n < 1 || !batchNo) && { opacity: 0.45 }]}>
          {busy ? <ActivityIndicator color={C.bg} /> : <Text style={s.btnText}>Add {n || ''} to stock{batchNo ? ` · ${batchNo}` : ''}</Text>}
        </Pressable>
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={busy ? () => {} : onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
        <View style={[s.sheet, { paddingBottom: 18 + insets.bottom, maxHeight: '92%' }]}>
          <View style={s.head}>
            <Text style={s.title}>Add new stock</Text>
            {!busy && <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close"><Text style={s.close}>✕</Text></Pressable>}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 6 }}>{body}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: C.panel, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { color: C.text, fontSize: 19, fontWeight: '800' },
  close: { color: C.muted, fontSize: 20, fontWeight: '700', paddingHorizontal: 4 },
  box: { alignSelf: 'stretch', borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2, borderRadius: 18, padding: 14 },
  boxTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  item: { color: C.text, fontSize: 18, fontWeight: '700' },
  line: { color: C.sub, fontSize: 14, marginTop: 2 },
  lineMuted: { color: C.muted, fontSize: 12.5, marginTop: 2 },
  b: { color: C.text, fontWeight: '800' },
  big: { color: C.text, fontSize: 20, fontWeight: '800' },
  mono: { fontFamily: MONO },
  label: { color: C.sub, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 56, height: 56, borderRadius: 16, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel2 },
  stepText: { color: C.text, fontSize: 26, fontWeight: '600', marginTop: -2 },
  qty: { flex: 1, minWidth: 0, height: 56, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2, color: C.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  seg: { flexDirection: 'row', backgroundColor: C.panel2, borderRadius: 14, padding: 4, marginBottom: 10 },
  segBtn: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.cyan },
  segText: { color: C.sub, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: C.bg },
  batch: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  batchOn: { borderColor: C.cyan, backgroundColor: 'rgba(127,233,254,0.07)' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.muted },
  radioOn: { borderColor: C.cyan, backgroundColor: C.cyan },
  batchNo: { color: C.text, fontSize: 14.5, fontWeight: '700' },
  link: { color: C.cyan, fontWeight: '700', fontSize: 13.5, paddingVertical: 6 },
  hint: { color: C.muted, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  input: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2, color: C.text, fontSize: 16, paddingHorizontal: 14 },
  err: { color: C.red, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  btn: { backgroundColor: C.cyan, borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(127,233,254,0.5)' },
  btnText: { color: C.bg, fontSize: 17, fontWeight: '800' },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
});
