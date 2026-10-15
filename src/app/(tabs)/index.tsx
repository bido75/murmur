import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Banner, Button, Card, Empty, StatusPill, T } from '@/components/ui';
import { getSettings, importAudio, listRecordings, localOnlyRecordings, upcomingEvents } from '@/lib/api';
import { briefParams, dayLabel, timeRange } from '@/lib/calendarUi';
import { minutes, shortDate } from '@/lib/format';
import { subscribe } from '@/lib/sync';
import { notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import { TEMPLATE_LABELS, type CalendarEvent, type Recording } from '@/lib/types';

export default function Recordings() {
  const t = useTheme();
  const [items, setItems] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [next, setNext] = useState<CalendarEvent | null>(null);

  // The next meeting in the coming 24 hours, if a calendar is connected.
  useFocusEffect(
    useCallback(() => {
      upcomingEvents(1)
        .then((r) => setNext(r.events.find((e) => new Date(e.start).getTime() - Date.now() < 24 * 3600_000) ?? null))
        .catch(() => setNext(null));
    }, []),
  );

  const load = useCallback(async () => {
    setLoading(true);
    const local = await localOnlyRecordings();
    try {
      const remote = await listRecordings();
      const ids = new Set(remote.map((r) => r.id));
      setItems([...local.filter((l) => !ids.has(l.id)), ...remote]);
      setOffline(false);
    } catch {
      setItems(local);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => subscribe(() => void load()), [load]);

  // While anything is processing, refresh every few seconds.
  const processing = items.some((r) => r.status !== 'ready' && r.status !== 'failed');
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [processing, load]);

  async function onImport() {
    try {
      const s = await getSettings();
      const id = await importAudio(s.defaultTemplate);
      if (id) void load();
    } catch (e) {
      notify("Couldn't import that file", (e as Error).message);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.muted} />}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            {offline ? <Banner text="You're offline. Recordings will upload when you're back online." /> : null}
            {next ? (
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/brief', params: briefParams(next) })}>
                <Card style={{ gap: 4, borderColor: t.accent }}>
                  <T muted size={12} weight="600">NEXT MEETING · {dayLabel(next.start).toUpperCase()} {timeRange(next)}</T>
                  <T weight="600" numberOfLines={2}>{next.title}</T>
                  <T size={13} style={{ color: t.accent }}>Open brief →</T>
                </Card>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={loading ? null : <Empty title="No recordings yet" body="Tap Record to capture a meeting, call, lecture or site walk." />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/recording/[id]', params: { id: item.id } })}
          >
            <Card style={{ gap: space.sm }}>
              <T size={17} weight="600" numberOfLines={2}>{item.title}</T>
              <T muted size={13}>
                {shortDate(item.created_at)} · {TEMPLATE_LABELS[item.template]}{item.duration_ms ? ` · ${minutes(item.duration_ms)}` : ''}
              </T>
              {item.status !== 'ready' && <StatusPill status={item.status} />}
            </Card>
          </Pressable>
        )}
      />

      <View style={[styles.dock, { backgroundColor: t.bg, borderTopColor: t.border }]}>
        <Button label="Import" kind="secondary" onPress={onImport} style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start recording"
          onPress={() => router.push('/record')}
          style={({ pressed }) => [styles.record, { backgroundColor: t.record, opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={styles.dot} />
          <T size={17} weight="700" style={{ color: '#fff' }}>Record</T>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: space.md, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  record: { flex: 2, minHeight: 50, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' },
});
