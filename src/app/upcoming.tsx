import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Banner, Button, Card, Empty, T } from '@/components/ui';
import { listProjects, upcomingEvents } from '@/lib/api';
import { briefParams, dayLabel, timeRange } from '@/lib/calendarUi';
import { notify } from '@/lib/dialog';
import { space, useTheme } from '@/lib/theme';
import type { CalendarEvent } from '@/lib/types';

export default function Upcoming() {
  const t = useTheme();
  const params = useLocalSearchParams<{ calendar?: string }>();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (params.calendar === 'connected') notify('Calendar connected', 'Your upcoming meetings now show here.');
    if (params.calendar === 'failed') notify("Couldn't connect the calendar", 'Please try again from Settings.');
  }, [params.calendar]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([upcomingEvents(7), listProjects()])
      .then(([r, ps]) => {
        setEvents(r.events);
        setConnected(r.connected.length > 0);
        setProblems(r.problems);
        setNames(Object.fromEntries(ps.map((p) => [p.id, p.name])));
      })
      .catch((e) => notify("Couldn't load your calendar", (e as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!connected) {
    return (
      <View style={{ padding: space.xl, gap: space.lg }}>
        <Empty title="No calendar connected" body="Connect Google or Microsoft in Settings to see briefs before each meeting." />
        <Button label="Go to Settings" kind="secondary" onPress={() => router.push('/settings')} />
      </View>
    );
  }

  const list = events ?? [];
  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.muted} />}
    >
      {problems.length > 0 && <Banner text={`Couldn't reach ${problems.join(' and ')}. Reconnect it in Settings if this keeps happening.`} />}
      {events?.length === 0 && <Empty title="Nothing in the next 7 days" />}
      {list.map((e, i) => {
        const day = dayLabel(e.start);
        const header = i === 0 || dayLabel(list[i - 1].start) !== day ? day : null;
        return (
          <View key={`${e.provider}:${e.id}`} style={{ gap: space.sm }}>
            {header && <T muted size={13} weight="600" style={{ marginTop: space.md }}>{header.toUpperCase()}</T>}
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/brief', params: briefParams(e) })}>
              <Card style={{ gap: 4 }}>
                <T weight="600" numberOfLines={2}>{e.title}</T>
                <T muted size={13}>
                  {timeRange(e)}
                  {e.platform ? ` · ${e.platform === 'meet' ? 'Google Meet' : e.platform === 'teams' ? 'Teams' : e.platform === 'zoom' ? 'Zoom' : 'Webex'}` : e.location ? ` · ${e.location}` : ''}
                </T>
                {e.match && names[e.match.project_id] ? (
                  <T size={13} style={{ color: t.accent }}>{names[e.match.project_id]}</T>
                ) : (
                  <T muted size={13}>No project yet</T>
                )}
              </Card>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}
