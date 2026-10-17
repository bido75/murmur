import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { ActionMenu } from '@/components/ActionMenu';
import { ToggleRow } from '@/components/ToggleRow';
import { Button, Card, T } from '@/components/ui';
import {
  addTopicAlert,
  botAvailable,
  deleteTopicAlert,
  getRoutines,
  listCalendarConnections,
  listProjects,
  listTopicAlerts,
  saveRoutines,
  type Routines,
  type TopicAlert,
} from '@/lib/api';
import { notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import type { Project } from '@/lib/types';

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export default function Alerts() {
  const t = useTheme();
  const [alerts, setAlerts] = useState<TopicAlert[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [routines, setRoutines] = useState<Routines | null>(null);
  const [hasCalendar, setHasCalendar] = useState(false);
  const [hasBot, setHasBot] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [email, setEmail] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    listTopicAlerts().then(setAlerts).catch((e) => notify("Couldn't load alerts", (e as Error).message));
    listProjects().then(setProjects).catch(() => setProjects([]));
    getRoutines().then(setRoutines).catch(() => setRoutines({ weekly_digest: false, auto_notetaker: false, timezone: null }));
    listCalendarConnections().then((c) => setHasCalendar(c.length > 0)).catch(() => setHasCalendar(false));
    botAvailable().then(setHasBot);
  }, []);

  async function update(patch: Partial<Routines>) {
    if (!routines) return;
    const next = { ...routines, ...patch };
    // The digest goes out Monday morning in this time zone.
    if (patch.weekly_digest && !next.timezone) next.timezone = deviceZone();
    setRoutines(next);
    try {
      await saveRoutines({ ...patch, ...(next.timezone !== routines.timezone ? { timezone: next.timezone } : {}) });
    } catch (e) {
      setRoutines(routines);
      notify("Couldn't save", (e as Error).message);
    }
  }

  async function add() {
    try {
      await addTopicAlert(phrase, projectId, email);
      setPhrase('');
      setAlerts(await listTopicAlerts());
    } catch (e) {
      notify("Couldn't add alert", (e as Error).message);
    }
  }

  async function remove(a: TopicAlert) {
    await deleteTopicAlert(a.id).catch((e) => notify("Couldn't delete", (e as Error).message));
    setAlerts(await listTopicAlerts().catch(() => alerts));
  }

  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? 'a project' : 'All projects');
  const input = { flex: 1, minWidth: 0, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, minHeight: 44 } as const;
  const zone = routines?.timezone ?? deviceZone();

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <T weight="600">Topic alerts</T>
        <T muted size={14}>Get a notification when a word or phrase comes up in a recording — “change order”, “injury”, “cancel”, a competitor’s name.</T>
        {alerts.map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: t.border }}>
            <View style={{ flex: 1 }}>
              <T>“{a.phrase}”</T>
              <T muted size={13}>{projectName(a.project_id)}{a.email ? ' · notification and email' : ' · notification'}</T>
            </View>
            <Button label="Remove" kind="ghost" onPress={() => void remove(a)} />
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput value={phrase} onChangeText={setPhrase} placeholder="Word or phrase" placeholderTextColor={t.muted} style={input} accessibilityLabel="Alert phrase" />
          <Button label="Add" kind="secondary" onPress={add} disabled={phrase.trim().length < 2} style={{ minHeight: 44 }} />
        </View>
        <Button label={`In: ${projectName(projectId)}`} kind="ghost" onPress={() => setPicking(true)} />
        <ToggleRow label="Also email me" value={email} onChange={setEmail} />
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">Weekly digest</T>
        <ToggleRow
          label="Email me every Monday"
          hint={`Last week’s recordings, open tasks and what got done. Sent around 8am${zone ? ` (${zone})` : ''}.`}
          value={!!routines?.weekly_digest}
          onChange={(v) => void update({ weekly_digest: v })}
        />
        {routines?.weekly_digest && zone !== deviceZone() && deviceZone() && (
          <Button label={`Use this device’s time zone (${deviceZone()})`} kind="ghost" onPress={() => void update({ timezone: deviceZone() })} />
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">Automatic notetaker</T>
        {hasBot ? (
          <>
            <ToggleRow
              label="Send a notetaker to my calendar meetings"
              hint="Joins Zoom, Meet, Teams and Webex meetings on your connected calendar, announced by name. You can cancel any of them from the recording."
              value={!!routines?.auto_notetaker}
              onChange={(v) => (v && !hasCalendar ? router.push('/(tabs)/settings') : void update({ auto_notetaker: v }))}
            />
            {!hasCalendar && <T muted size={13}>Connect a calendar in Settings first.</T>}
          </>
        ) : (
          <T muted size={14}>The meeting notetaker isn’t set up on the server yet (see README: Recall.ai).</T>
        )}
      </Card>

      <ActionMenu
        visible={picking}
        title="Alert in"
        onClose={() => setPicking(false)}
        actions={[{ label: 'All projects', onPress: () => setProjectId(null) }, ...projects.map((p) => ({ label: p.name, onPress: () => setProjectId(p.id) }))]}
      />
    </ScrollView>
  );
}
