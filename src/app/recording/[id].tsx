import { useAudioPlayer } from 'expo-audio';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ActionMenu, type MenuAction } from '@/components/ActionMenu';
import { SendToTracker } from '@/components/SendToTracker';
import { PhotoStrip, PhotoViewer, SiteLogView } from '@/components/SiteLog';
import { TaskRow } from '@/components/TaskRow';
import { Banner, Button, Card, Empty, Segmented, StatusPill, T } from '@/components/ui';
import { ask, audioUrl, cancelBot, consentResponses, currentUserId, deletePhoto, getBot, deleteRecording, getRecording, listIntegrations, listProjects, renameRecording, retryProcessing, sendSiteLogToProcore, setPhotoCaption, setRecordingProject, updateTask } from '@/lib/api';
import { confirm, isWeb, notify } from '@/lib/dialog';
import { queuePhoto, takePhoto } from '@/lib/photos';
import { clock, minutes, shortDate, speakerLabel } from '@/lib/format';
import { radius, space, useTheme } from '@/lib/theme';
import { CONSENT_LABELS, TEMPLATE_LABELS, type ConsentResponse, type Integration, type MeetingBot, type Photo, type Project, type Task } from '@/lib/types';

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
  const [me, setMe] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  useEffect(() => {
    currentUserId().then(setMe);
    listIntegrations().then(setIntegrations).catch(() => setIntegrations([]));
  }, []);

  const [responses, setResponses] = useState<ConsentResponse[]>([]);
  const [bot, setBot] = useState<MeetingBot | null>(null);
  const load = useCallback(
    () =>
      getRecording(id)
        .then(async (d) => {
          setData(d);
          if (d.recording) setTitle((prev) => prev || d.recording!.title);
          setResponses(await consentResponses(id));
          if (d.recording?.source === 'bot') setBot(await getBot(id));
        })
        .catch((e) => notify("Couldn't load recording", (e as Error).message)),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const status = data?.recording?.status;
  useEffect(() => {
    if (!status || ['ready', 'failed', 'cancelled'].includes(status)) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [status, load]);

  /** Play from a moment in the recording, across segment files. */
  async function playAt(ms: number) {
    const segs = data?.segments ?? [];
    if (!segs.length) return;
    if (data?.recording?.audio_deleted_at) {
      notify('Audio removed', 'The audio was deleted by your retention setting. The transcript and notes are kept.');
      return;
    }
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
        // Link imports play straight from the link.
        const url = seg.storage_path ? await audioUrl(seg.storage_path) : seg.source_url;
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

  async function addPhoto(source: 'camera' | 'library') {
    const rec = data?.recording;
    if (!rec) return;
    try {
      const shot = await takePhoto(source);
      if (!shot) return;
      await queuePhoto(rec.id, shot, null);
      await load();
    } catch (e) {
      notify("Couldn't add the photo", (e as Error).message);
    }
  }

  const procore = integrations.find((i) => i.provider === 'procore');

  async function sendLog() {
    const rec = data?.recording;
    if (!rec) return;
    if (!procore?.config.target) {
      notify('Choose a Procore project first', 'Go to Settings → Task trackers → Procore and pick the project.');
      return;
    }
    const ok = await confirm('Add to Procore daily log?', `The site log (verified entries only) is added as a note in ${procore.config.target.name}'s daily log for the day it was recorded.`, 'Add');
    if (!ok) return;
    try {
      const res = await sendSiteLogToProcore(rec.id, rec.created_at);
      await load();
      notify(res.already ? 'Already in Procore' : 'Added to Procore', 'Open it from the site log.');
    } catch (e) {
      notify("Couldn't send to Procore", (e as Error).message);
    }
  }

  function openMenu() {
    const rec = data?.recording;
    if (!rec) return;
    // Teammates can read and export a shared recording; only its creator can change it.
    const isOwner = !rec.user_id || rec.user_id === me;
    const actions: MenuAction[] = [
      { label: 'Make a deck', onPress: () => router.push({ pathname: '/deck', params: { recordingId: rec.id } }) },
      { label: 'Share, email or export', onPress: () => router.push({ pathname: '/share', params: { id: rec.id } }) },
    ];
    if (isOwner) {
      if (!isWeb) actions.push({ label: 'Take a photo', onPress: () => void addPhoto('camera') });
      actions.push({ label: 'Add a photo from library', onPress: () => void addPhoto('library') });
      actions.push(
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
      );
    }
    setMenu({ title: rec.title, actions });
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
              editable={!rec.user_id || rec.user_id === me}
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
            {bot && !['done', 'cancelled'].includes(bot.status) && rec.status !== 'ready' && (
              <Banner
                text={
                  bot.status === 'scheduled'
                    ? `Notetaker will join${bot.join_at ? ` at ${new Date(bot.join_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ' shortly'}.`
                    : bot.status_detail ?? `Notetaker: ${bot.status.replace(/_/g, ' ')}`
                }
                action={
                  rec.user_id === me
                    ? {
                        label: bot.status === 'scheduled' ? 'Cancel' : 'Make it leave',
                        onPress: () => void cancelBot(rec.id).then(load).catch((e) => notify("Couldn't cancel", (e as Error).message)),
                      }
                    : undefined
                }
              />
            )}
            {rec.audio_deleted_at && <T muted size={13}>Audio removed by your retention setting; transcript and notes kept.</T>}
            {rec.status === 'failed' && (
              <Banner
                text={rec.error ?? 'Processing failed.'}
                action={rec.user_id === me ? { label: 'Retry', onPress: () => void retryProcessing(rec.id).then(load) } : undefined}
              />
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

          {tab === 'notes' && (
            <Notes
              data={data}
              playAt={playAt}
              onOpenPhoto={setViewing}
              procore={procore?.config.target ? { target: procore.config.target.name, onSend: sendLog } : null}
              responses={responses}
            />
          )}
          <PhotoViewer
            photo={viewing}
            onClose={() => setViewing(null)}
            onPlay={data.segments.length ? playAt : undefined}
            canEdit={!rec.user_id || rec.user_id === me}
            onCaption={(p, c) => void setPhotoCaption(p.id, c).then(load).catch((e) => notify("Couldn't save caption", (e as Error).message))}
            onDelete={async (p) => {
              const ok = await confirm('Delete this photo?', 'It is removed from the recording and any reports made later.', 'Delete', true);
              if (!ok) return;
              setViewing(null);
              await deletePhoto(p).catch((e) => notify("Couldn't delete", (e as Error).message));
              await load();
            }}
          />
          <ActionMenu visible={!!menu} title={menu?.title} actions={menu?.actions ?? []} onClose={() => setMenu(null)} />
          {tab === 'transcript' && <TranscriptView data={data} playAt={playAt} onOpenPhoto={setViewing} />}
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

function Notes({ data, playAt, onOpenPhoto, procore, responses }: {
  data: Data;
  playAt: (ms: number) => void;
  onOpenPhoto: (p: Photo) => void;
  procore: { target: string; onSend: () => void } | null;
  responses: ConsentResponse[];
}) {
  const t = useTheme();
  const s = data.summary;
  const photos = data.photos;
  if (!s) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        {photos.length > 0 && (
          <Section title={`Photos (${photos.length})`}>
            <PhotoStrip photos={photos} onOpen={onOpenPhoto} />
          </Section>
        )}
        <Empty title="Writing your notes…" body="This usually takes a minute or two after you stop." />
      </ScrollView>
    );
  }
  const sentTo = s.site_log_external?.procore?.url;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}>
      {!!s.overview && <T size={17}>{s.overview}</T>}
      {photos.length > 0 && (
        <Section title={`Photos (${photos.length})`}>
          <PhotoStrip photos={photos} onOpen={onOpenPhoto} />
        </Section>
      )}
      {s.site_log && (
        <Section title="Daily site log">
          <SiteLogView log={s.site_log} photos={photos} playAt={playAt} onOpenPhoto={onOpenPhoto} />
          {sentTo ? (
            <Button label="Open in Procore daily log ↗" kind="ghost" onPress={() => void Linking.openURL(sentTo)} />
          ) : procore ? (
            <Button label={`Add to ${procore.target} daily log`} kind="secondary" onPress={procore.onSend} />
          ) : null}
        </Section>
      )}
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
      {responses.length > 0 && (
        <Section title={`Consent link answers (${responses.length})`}>
          {responses.map((r) => (
            <T key={r.id} size={14} style={{ color: r.decision === 'decline' ? t.danger : t.ink }}>
              {r.decision === 'agree' ? '✓ ' : '✕ '}
              {r.name}
              {r.email ? ` (${r.email})` : ''} {r.decision === 'agree' ? 'agreed' : 'did not agree'}
            </T>
          ))}
          {responses.some((r) => r.decision === 'decline') && (
            <T muted size={13}>Someone didn’t agree. Consider deleting their parts or the recording, and check the law where they are.</T>
          )}
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

type Line = { kind: 'u'; u: NonNullable<Data['transcript']>['utterances'][number]; prevSpeaker: number | null } | { kind: 'p'; photos: Photo[] };

/** Utterances with the photos taken during them slotted in at the right moment. */
function withPhotos(u: NonNullable<Data['transcript']>['utterances'], photos: Photo[]): Line[] {
  const timed = photos.filter((p) => p.taken_ms != null).sort((a, b) => a.taken_ms! - b.taken_ms!);
  const out: Line[] = [];
  let j = 0;
  let prev: number | null = null;
  for (const item of u) {
    const group: Photo[] = [];
    while (j < timed.length && timed[j].taken_ms! < item.start_ms) group.push(timed[j++]);
    if (group.length) {
      out.push({ kind: 'p', photos: group });
      prev = null; // repeat the speaker label after a photo
    }
    out.push({ kind: 'u', u: item, prevSpeaker: prev });
    prev = item.speaker;
  }
  if (j < timed.length) out.push({ kind: 'p', photos: timed.slice(j) });
  return out;
}

function TranscriptView({ data, playAt, onOpenPhoto }: { data: Data; playAt: (ms: number) => void; onOpenPhoto: (p: Photo) => void }) {
  const t = useTheme();
  const u = data.transcript?.utterances ?? [];
  const names = data.transcript?.speaker_names ?? {};
  if (!u.length) return <Empty title="No transcript yet" />;
  const lines = withPhotos(u, data.photos);
  return (
    <FlatList
      data={lines}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
      renderItem={({ item: line }) => {
        if (line.kind === 'p') {
          return (
            <View style={{ paddingVertical: space.sm }}>
              <PhotoStrip photos={line.photos} onOpen={onOpenPhoto} size={88} />
            </View>
          );
        }
        const item = line.u;
        const sameSpeaker = line.prevSpeaker === item.speaker;
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
