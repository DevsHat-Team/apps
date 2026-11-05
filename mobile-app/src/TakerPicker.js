import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';

/** "Stock out for": Office (the normal stock out) or a person of a clinic (Dr Ibrahim Clinic · Wahab …). */
export function TakerPicker({ takers, value, onPick, onClose }) {
  const insets = useSafeAreaInsets();
  const groups = [];
  for (const t of takers) {
    let g = groups.find((x) => x.group === t.group);
    if (!g) { g = { group: t.group, people: [] }; groups.push(g); }
    g.people.push(t);
  }
  const Row = ({ id, name, sub }) => {
    const on = (value || null) === id;
    return (
      <Pressable onPress={() => onPick(id)} style={[s.row, on && s.rowOn]} accessibilityState={{ selected: on }}>
        <View style={[s.radio, on && { borderColor: id ? C.violet : C.red }]}>{on && <View style={[s.radioIn, { backgroundColor: id ? C.violet : C.red }]} />}</View>
        <View style={{ flex: 1 }}>
          <Text style={[s.name, on && { color: '#fff' }]}>{name}</Text>
          {!!sub && <Text style={s.sub}>{sub}</Text>}
        </View>
      </Pressable>
    );
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={s.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
          <View style={s.grip} />
          <Text style={s.title}>Stock out for</Text>
          <Text style={s.hint}>Every Stock Out scan goes in this name until you change it.</Text>
          <ScrollView>
            <Row id={null} name="Office" sub="The normal stock out" />
            {groups.map((g) => (
              <View key={g.group}>
                <Text style={s.h}>{g.group || 'Other'}</Text>
                {g.people.map((t) => <Row key={t.id} id={t.id} name={t.name} sub={t.note} />)}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: C.panel, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, maxHeight: '80%' },
  grip: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(143,155,194,0.4)', marginBottom: 10 },
  title: { color: C.text, fontSize: 18, fontWeight: '800', marginLeft: 4 },
  hint: { color: C.muted, fontSize: 12.5, marginLeft: 4, marginTop: 2, marginBottom: 10 },
  h: { color: C.muted, fontSize: 12.5, fontWeight: '800', marginTop: 14, marginBottom: 6, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.panel2, marginBottom: 6, borderWidth: 1.5, borderColor: 'transparent' },
  rowOn: { borderColor: 'rgba(183,156,255,0.6)' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  radioIn: { width: 10, height: 10, borderRadius: 5 },
  name: { color: C.text, fontSize: 15.5, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 12, marginTop: 1 },
});
