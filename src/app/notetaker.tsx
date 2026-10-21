import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { ProjectPicker } from '@/components/ProjectPicker';
import { Button, Card, T } from '@/components/ui';
import { scheduleBot } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { scheduledInTime } from '@/lib/shared';
import { radius, space, useTheme } from '@/lib/theme';

/**
 * Send a notetaker bot to a meeting you can't attend (or don't want to run the recorder for).
 * It joins under its own name and posts a recording notice in the meeting chat.
 */
export default function Notetaker() {
  const p = useLocalSearchParams<{ url?: string; start?: string; title?: string; projectId?: string; key?: string }>();
  const t = useTheme();
  const [url, setUrl] = useState(p.url ?? '');
  const [title, setTitle] = useState(p.title ?? '');
  const [projectId, setProjectId] = useState<string | null>(p.projectId || null);
  const [busy, setBusy] = useState(false);
  const start = p.start ? new Date(p.start) : null;
  // Decided once when the screen opens: join at the meeting's start if it's still ahead.
  const [future] = useState(() => !!start && start.getTime() > Date.now() + 60_000);
  // A notetaker can only be held for a meeting that starts at least ten minutes from now.
  // With less notice it joins straight away, and the host may have to let it in.
  const reserved = future && scheduledInTime(start!.toISOString());
  const joinAt = reserved ? start!.toISOString() : null;

  async function send() {
    setBusy(true);
    try {
      const { recording_id } = await scheduleBot({ meetingUrl: url.trim(), joinAt, title, projectId, eventKey: p.key || null });
      notify(reserved ? 'Notetaker scheduled' : 'Notetaker on its way', reserved ? `It will join at ${start!.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'It joins in about a minute. The host may need to let it in.');
      router.replace({ pathname: '/recording/[id]', params: { id: recording_id } });
    } catch (e) {
      notify("Couldn't send the notetaker", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <T muted>Zoom, Google Meet, Microsoft Teams or Webex. The notes arrive here when the meeting ends, like any recording.</T>
      <TextInput value={url} onChangeText={setUrl} placeholder="Meeting link" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} accessibilityLabel="Meeting link" />
      <TextInput value={title} onChangeText={setTitle} placeholder="Title (optional)" placeholderTextColor={t.muted} style={input} accessibilityLabel="Title" />
      <View style={{ gap: space.sm }}>
        <T muted size={13} weight="600">PROJECT</T>
        <ProjectPicker value={projectId} onChange={setProjectId} />
      </View>
      <Card style={{ gap: space.sm }}>
        <T weight="600">How it tells people</T>
        <T size={14}>It joins as “Notetaker” and posts in the meeting chat that it’s recording, for whom, and how to remove it. Zoom hosts are asked to allow recording.</T>
        <T muted size={13}>Where everyone must agree to be recorded, make sure they do. You can send the consent link with the invite.</T>
      </Card>
      <Button label={reserved ? `Join at ${start!.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Join now'} onPress={send} loading={busy} disabled={!url.trim()} />
      {future && !reserved ? (
        <T muted size={13}>This meeting starts too soon to hold a notetaker for it, so it will join straight away instead. The host may need to let it in.</T>
      ) : null}
    </ScrollView>
  );
}
