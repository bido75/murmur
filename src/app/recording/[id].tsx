import { useAudioPlayer } from 'expo-audio';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ActionMenu, type MenuAction } from '@/components/ActionMenu';
import { SendToTracker } from '@/components/SendToTracker';
import { TaskRow } from '@/components/TaskRow';
import { Banner, Button, Card, Empty, Segmented, StatusPill, T } from '@/components/ui';
import { ask, audioUrl, deleteRecording, getRecording, listProjects, renameRecording, retryProcessing, setRecordingProject, updateTask } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { shareText, sharePdf } from '@/lib/export';
import { clock, minutes, shortDate, speakerLabel } from '@/lib/format';
import { radius, space, useTheme } from '@/lib/theme';
import { CONSENT_LABELS, TEMPLATE_LABELS, type Project, type Task } from '@/lib/types';

type Data = Awaited<ReturnType<typeof getRecording>>;
type Tab = 'notes' | 'transcript' | 'tasks' | 'ask';

export default function RecordingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('notes');
  const [title, setTitle] = useState('');
  const player = useAudioPlayer(null);
  const [loadedSegment, setLoadedSegment] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ title?: string; actions: MenuAction[] } | null>(null);

  const load = useCallback(
    () =>
      getRecording(id)
        .then((d) => {
          setData(d);
          if (d.recording) setTitle((prev) => prev || d.recording!.title);
        })
        .catch((e) => notify("Couldn't load recording", (e as Error).message)),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const status = data?.recording?.status;
  useEffect(() => {
    if (!status || status === 'ready' || status === 'failed') return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [status, load]);

  /** Play from a moment in the recording, across segment files. */
  async function playAt(ms: number) {
    const segs = data?.segments ?? [];
    if (!segs.length) return;
    // Walk the segments to find the file containing `ms`. A segment with unknown
    // duration (recovered or imported) is treated as running to the end.
    let offset = 0;
    let seg = segs[0];
    for (let i = 0; i < segs.length; i++) {
      seg = segs[i];
      const last = i === segs.length - 1;
      if (last || !seg.duration_ms || ms < offset + seg.duration_ms) break;
      offset += seg.duration_ms;
    }
    try {
      if (loadedSegment !== seg.idx) {
        const url = await audioUrl(seg.storage_path);
        if (!url) throw new Error('Audio is not available');
        player.replace({ uri: url });
        setLoadedSegment(seg.idx);
      }
      await player.seekTo(Math.max(0, (ms - offset) / 1000 - 1));
      player.play();
    } catch (e) {
      notify("Can't play audio", (e as Error).message);
    }
  }

  async function setTask(task: Task, patch: Partial<Task>) {
    setData((d) => (d ? { ...d, tasks: d.tasks.map((x) => (x.id === task.id ? { ...x, ...patch } : x)) } : d));
    try {
      await updateTask(task.id, patch);
    } catch (e) {
      notify("Couldn't update task", (e as Error).message);
      void load();
    }
  }

  const guard = (fn: () => void | Promise<void>) => async () => {
    try {
      await fn();
    } catch (e) {
      notify('Something went wrong', (e as Error).message);
    }
  };

  async function chooseProject() {
    const rec = data?.recording;
    if (!rec) return;
    const projects: Project[] = await listProjects().catch(() => []);
    setMenu({
      title: 'Move to project',
      actions: [
        { label: 'No project', onPress: guard(async () => { await setRecordingProject(rec.id, null); await load(); }) },
        ...projects.map((p) => ({
          label: p.id === rec.project_id ? `${p.name} ✓` : p.name,
          onPress: guard(async () => { await setRecordingProject(rec.id, p.id); await load(); }),
        })),
      ],
    });
  }

  function openMenu() {
    const rec = data?.recording;
    if (!rec) return;
    setMenu({
      title: rec.title,
      actions: [
        { label: 'Make a deck', onPress: () => router.push({ pathname: '/deck', params: { recordingId: rec.id } }) },
        { label: 'Share as text', onPress: guard(() => shareText(rec, data.summary, data.tasks)) },
        { label: 'Share as PDF', onPress: guard(() => sharePdf(rec, data.summary, data.tasks)) },
        { label: 'Move to project', onPress: () => void chooseProject() },
        { label: 'Re-run notes', onPress: guard(async () => { await retryProcessing(rec.id); await load(); }) },
        {
          label: 'Delete recording',
          destructive: true,
          onPress: guard(async () => {
            const ok = await confirm('Delete this recording?', 'The audio, transcript, notes and tasks are deleted permanently.', 'Delete', true);
            if (!ok) return;
            await deleteRecording(rec.id);
            router.back();
          }),
        },
      ],
    });
  }

  const rec = data?.recording;
  const reviewCount = data?.tasks.filter((x) => x.needs_review && x.status === 'open').length ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="More actions" hitSlop={12}>
              <T size={22} weight="700" style={{ color: t.accent }}>···</T>
            </Pressable>
          ),
        }}
      />
      {!data ? null : !rec ? (
        <Empty title="Waiting to upload" body="This recording hasn't reached the server yet. It will upload automatically when you're online." />
      ) : (
        <>
          <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.md }}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              onEndEditing={() => title.trim() && title !== rec.title && void renameRecording(rec.id, title.trim())}
              style={{ color: t.ink, fontSize: 24, fontWeight: '700' }}
              accessibilityLabel="Recording title"
              multiline
              blurOnSubmit
            />
            <T muted size={13}>
              {shortDate(rec.created_at)} · {TEMPLATE_LABELS[rec.template]}{rec.duration_ms ? ` · ${minutes(rec.duration_ms)}` : ''}
            </T>
            {rec.status !== 'ready' && <StatusPill status={rec.status} />}
            {rec.status === 'failed' && (
              <Banner text={rec.error ?? 'Processing failed.'} action={{ label: 'Retry', onPress: () => void retryProcessing(rec.id).then(load) }} />
            )}
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { key: 'notes', label: 'Notes' },
                { key: 'transcript', label: 'Transcript' },
                { key: 'tasks', label: reviewCount ? `Tasks (${reviewCount}!)` : `Tasks${data.tasks.length ? ` (${data.tasks.length})` : ''}` },
                { key: 'ask', label: 'Ask' },
              ]}
            />
          </View>

          {tab === 'notes' && <Notes data={data} playAt={playAt} />}
          <ActionMenu visible={!!menu} title={menu?.title} actions={menu?.actions ?? []} onClose={() => setMenu(null)} />
          {tab === 'transcript' && <TranscriptView data={data} playAt={playAt} />}
          {tab === 'tasks' && (
            <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}>
              {data.tasks.some((x) => x.status === 'open' && !x.needs_review) && <SendToTracker tasks={data.tasks} onDone={load} />}
              {data.tasks.length === 0 ? (
                <Empty title={rec.status === 'ready' ? 'No action items' : 'Tasks appear when notes are ready'} />
              ) : (
                data.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => setTask(task, { status: task.status === 'done' ? 'open' : 'done' })}
                    onAccept={() => setTask(task, { needs_review: false, kind: 'commitment' })}
                    onDismiss={() => setTask(task, { status: 'dismissed' })}
                    onQuotePress={task.quote_ms != null ? () => playAt(task.quote_ms!) : undefined}
                  />
                ))
              )}
            </ScrollView>
          )}
          {tab === 'ask' && <AskView recordingId={rec.id} />}
        </>
      )}
    </View>
  );
}

function Notes({ data, playAt }: { data: Data; playAt: (ms: number) => void }) {
  const t = useTheme();
  const s = data.summary;
  if (!s) return <Empty title="Writing your notes…" body="This usually takes a minute or two after you stop." />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}>
      {!!s.overview && <T size={17}>{s.overview}</T>}
      {s.key_points.length > 0 && (
        <Section title="Key points">
          {s.key_points.map((p, i) => <T key={i}>•  {p}</T>)}
        </Section>
      )}
      {s.decisions.length > 0 && (
        <Section title="Decisions">
          {s.decisions.map((d, i) => (
            <Card key={i} style={{ gap: 4 }}>
              <T weight="600">{d.text}</T>
              <Pressable disabled={d.quote_ms == null} onPress={() => d.quote_ms != null && playAt(d.quote_ms)}>
                <T muted size={13} style={{ fontStyle: 'italic' }}>
                  “{d.quote}”{d.quote_ms != null ? `  ${clock(d.quote_ms)}` : ''}{d.verified ? '' : '  (not found in transcript)'}
                </T>
              </Pressable>
            </Card>
          ))}
        </Section>
      )}
      {(s.task_updates ?? []).length > 0 && (
        <Section title="Earlier tasks discussed">
          {(s.task_updates ?? []).map((u, i) => (
            <Card key={i} style={{ gap: 4 }}>
              <T weight="600">
                {u.status === 'done' ? '✓ Done: ' : u.status === 'blocked' ? 'Blocked: ' : 'In progress: '}
                {u.text}
              </T>
              {u.note ? <T size={14}>{u.note}</T> : null}
              {u.quote ? (
                <Pressable disabled={u.quote_ms == null} onPress={() => u.quote_ms != null && playAt(u.quote_ms)}>
                  <T muted size={13} style={{ fontStyle: 'italic' }}>
                    “{u.quote}”{u.quote_ms != null ? `  ${clock(u.quote_ms)}` : ''}
                    {u.verified ? '' : '  (not found in transcript, task left open)'}
                  </T>
                </Pressable>
              ) : null}
            </Card>
          ))}
        </Section>
      )}
      {s.open_questions.length > 0 && (
        <Section title="Open questions">
          {s.open_questions.map((q, i) => <T key={i}>•  {q}</T>)}
        </Section>
      )}
      {data.recording?.consent_method && (
        <T muted size={12}>
          Recording notice: {CONSENT_LABELS[data.recording.consent_method]}
          {data.recording.consent_confirmed_at ? ` (${new Date(data.recording.consent_confirmed_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})` : ''}
        </T>
      )}
      <T muted size={12} style={{ color: t.muted }}>AI-generated from the transcript. Check important details against the audio.</T>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <T muted size={13} weight="600">{title.toUpperCase()}</T>
      {children}
    </View>
  );
}

function TranscriptView({ data, playAt }: { data: Data; playAt: (ms: number) => void }) {
  const t = useTheme();
  const u = data.transcript?.utterances ?? [];
  const names = data.transcript?.speaker_names ?? {};
  if (!u.length) return <Empty title="No transcript yet" />;
  return (
    <FlatList
      data={u}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
      renderItem={({ item, index }) => {
        const sameSpeaker = index > 0 && u[index - 1].speaker === item.speaker;
        return (
          <Pressable onPress={() => playAt(item.start_ms)} accessibilityHint="Plays audio from here" style={{ paddingVertical: 6 }}>
            {!sameSpeaker && (
              <T size={13} weight="700" style={{ color: t.accent, marginTop: space.sm }}>
                {speakerLabel(item.speaker, names)}  <T muted size={12}>{clock(item.start_ms)}</T>
              </T>
            )}
            <T>{item.text}</T>
          </Pressable>
        );
      }}
    />
  );
}

function AskView({ recordingId }: { recordingId: string }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);

  async function send() {
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setQ('');
    try {
      const res = await ask(question, recordingId);
      setHistory((h) => [...h, { q: question, a: res.answer }]);
    } catch (e) {
      setHistory((h) => [...h, { q: question, a: `Sorry, that didn't work: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {history.length === 0 && <T muted>Ask anything about this recording, e.g. “What did we agree on pricing?”</T>}
        {history.map((h, i) => (
          <View key={i} style={{ gap: space.sm }}>
            <T weight="600">{h.q}</T>
            <T>{h.a}</T>
          </View>
        ))}
      </ScrollView>
      <View style={[styles.askBar, { borderTopColor: t.border, backgroundColor: t.bg }]}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Ask about this recording"
          placeholderTextColor={t.muted}
          onSubmitEditing={send}
          returnKeyType="send"
          style={[styles.askInput, { borderColor: t.border, backgroundColor: t.surface, color: t.ink }]}
          accessibilityLabel="Question"
        />
        <Button label="Ask" onPress={send} loading={busy} disabled={!q.trim()} style={{ minHeight: 44 }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  askBar: { flexDirection: 'row', gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  askInput: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, minHeight: 44 },
});
