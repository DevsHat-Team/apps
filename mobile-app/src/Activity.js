import { memo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, TYPES } from './theme';

const pad = (n) => String(n).padStart(2, '0');
export function clock(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}
function minuteLabel(minute) {
  const ms = minute * 60000;
  const d = new Date(ms);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a, b) => a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return `${same(d, today) ? '' : same(d, y) ? 'Yesterday ' : `${d.getDate()}/${d.getMonth() + 1} `}${clock(ms)}`;
}

/**
 * Recent activity of this account (last 24 hours): one block per minute, one row per item and action with a count.
 * More than 1 of the same item in a minute is marked, so a double scan is easy to spot; ↺ takes back the last one.
 */
export const Activity = memo(function Activity({ groups, canUndo, onUndo, onRetry, onDismiss, onRefresh, loading, admin, expanded, onToggle, unsent }) {
  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={onToggle} style={s.head} hitSlop={6} accessibilityRole="button" accessibilityLabel={expanded ? 'Make the list smaller' : 'Make the list bigger'}>
        <View style={s.grip} />
        <View style={s.headRow}>
          <Text style={s.title}>Recent activity</Text>
          <Text style={s.sub} numberOfLines={1}>{expanded ? 'scanning paused · tap to scan' : `last 24 hours${admin ? '' : ' (yours)'}`}</Text>
          <View style={{ flex: 1 }} />
          {!!unsent && <Text style={[s.badge, { color: C.amber, borderColor: 'rgba(255,181,71,0.5)' }]}>{unsent} not sent</Text>}
        </View>
      </Pressable>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}
        refreshControl={<RefreshControl refreshing={!!loading} onRefresh={onRefresh} tintColor={C.cyan} colors={[C.cyan]} progressBackgroundColor={C.panel2} />}>
        {groups.length === 0 && (
          <Text style={s.empty}>{loading ? 'Loading…' : 'Your scans show here, newest first. Pull down to refresh.'}</Text>
        )}
        {groups.map((g) => (
          <View key={g.minute} style={s.block}>
            <Text style={s.minute}>{minuteLabel(g.minute)}{g.units ? `  ·  ${g.units} unit${g.units === 1 ? '' : 's'} this minute` : ''}</Text>
            {g.rows.map((r) => <Row key={r.key} r={r} canUndo={canUndo} onUndo={onUndo} onRetry={onRetry} onDismiss={onDismiss} admin={admin} />)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

function Row({ r, canUndo, onUndo, onRetry, onDismiss, admin }) {
  const t = TYPES[r.type] || TYPES.OUT;
  const newest = r.items[0];
  const saving = r.items.some((e) => e.state === 'saving' || e.state === 'undoing');
  const undoable = r.items.find((e) => canUndo(e));
  const check = !r.failed && !r.added && !r.received && r.count > 1; // more than one of the same item in a minute: check it was meant
  const color = r.failed ? C.red : r.added ? C.cyan : t.color;
  const what = r.added ? 'New stock' : r.received ? 'New units' : t.label;
  const left = admin && newest && typeof newest.left === 'number' ? ` · ${newest.left} left` : '';
  return (
    <View style={[s.row, check && s.rowCheck, r.failed && s.rowFail]}>
      <View style={[s.count, { borderColor: color + '66', backgroundColor: color + '1A' }]}>
        {r.failed
          ? <Text style={[s.countText, { color, fontSize: r.empty ? 12.5 : 18, textAlign: 'center' }]}>{r.empty ? 'Stock\n0' : '✕'}</Text>
          : <Text style={[s.countText, { color }]}>{t.sign}{r.count}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>{r.name}</Text>
        <Text style={[s.via, r.failed && { color: C.red }]} numberOfLines={2}>
          {r.failed
            ? r.empty
              ? `Stock 0 · nothing left in batch ${r.via.replace(/^Scan · /, '')}, not taken out${r.count > 1 ? ` (${r.count} scans)` : ''}`
              : `${r.count > 1 ? `${r.count} not saved · ` : ''}${newest.error || 'Not saved'}`
            : `${what} · ${r.via.replace(/^(Scan|New units|New stock) · /, '')}${left}${check ? '  ·  check: more than 1 this minute' : ''}`}
        </Text>
      </View>
      {saving ? (
        <ActivityIndicator color={C.muted} style={{ width: 44 }} />
      ) : r.failed ? (
        newest.retry ? (
          <Pressable onPress={() => onRetry(newest.key)} style={s.act} hitSlop={6} accessibilityLabel="Send again"><Text style={[s.actText, { color: C.cyan }]}>Send</Text></Pressable>
        ) : (
          <Pressable onPress={() => r.items.forEach((e) => onDismiss(e.key))} style={s.act} hitSlop={6} accessibilityLabel="Remove"><Text style={[s.actText, { color: C.muted }]}>✕</Text></Pressable>
        )
      ) : undoable ? (
        <Pressable onPress={() => onUndo(undoable)} style={s.act} hitSlop={6} accessibilityLabel="Undo">
          <Text style={[s.actText, { fontSize: 20 }]}>↺</Text>
        </Pressable>
      ) : <View style={{ width: 44 }} />}
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 16 },
  grip: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(143,155,194,0.4)', marginBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  title: { color: C.text, fontSize: 16, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 12.5, marginLeft: 8, flexShrink: 1 },
  clear: { color: C.muted, fontSize: 12.5, fontWeight: '700', marginLeft: 12 },
  badge: { fontSize: 11.5, fontWeight: '800', borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  empty: { color: C.muted, fontSize: 13.5, textAlign: 'center', paddingHorizontal: 24, paddingTop: 22, lineHeight: 20 },
  block: { paddingHorizontal: 12, marginBottom: 6 },
  minute: { color: C.muted, fontSize: 12, fontWeight: '700', paddingHorizontal: 4, paddingTop: 8, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingLeft: 10, paddingRight: 4, paddingVertical: 8, borderRadius: 14, backgroundColor: C.panel2, marginBottom: 6, borderWidth: 1.5, borderColor: 'transparent' },
  rowCheck: { borderColor: 'rgba(255,181,71,0.55)', backgroundColor: 'rgba(255,181,71,0.07)' },
  rowFail: { borderColor: 'rgba(255,92,102,0.45)' },
  count: { minWidth: 50, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { fontSize: 18, fontWeight: '800' },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  via: { color: C.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  act: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actText: { color: C.sub, fontSize: 15, fontWeight: '800' },
});
