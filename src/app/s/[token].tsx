// Public, read-only notes behind a share link. No account needed.
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, TextInput, View } from 'react-native';
import { SharedAudio, type AudioPart } from '@/components/SharedAudio';
import { Button, Card, T } from '@/components/ui';
import { publicCall, PublicError } from '@/lib/api';
import { clock, minutes } from '@/lib/format';
import { radius, space, useTheme } from '@/lib/theme';

type Notes = {
  title: string;
  date: string;
  duration_ms: number;
  overview: string;
  key_points: string[];
  decisions: { text: string; quote: string | null }[];
  tasks: { text: string; owner: string | null; due: string | null; done: boolean }[];
  open_questions: string[];
  site_log: { title: string; items: string[] }[];
  transcript: { at: string; speaker: string; text: string }[] | null;
};
type Audio = AudioPart;
type Payload = { notes: Notes; photos: { url: string; caption: string | null }[]; app: string; audio: Audio[]; can_ask: boolean; clip: { start_ms: number; end_ms: number; title: string | null } | null };

export default function SharedNotes() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTheme();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState<string | undefined>(undefined);

  const load = useCallback(
    (pw?: string) =>
      publicCall<Payload>(`share/view?token=${encodeURIComponent(token ?? '')}`, { password: pw })
        .then((d) => {
          setData(d);
          setNeedsPassword(false);
          setTried(pw);
        })
        .catch((e) => {
          if (e instanceof PublicError && e.status === 401) {
            setNeedsPassword(true);
            setError(pw ? e.message : null);
          } else setError((e as Error).message);
        }),
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (needsPassword) {
    return (
      <View style={{ flex: 1, padding: space.xl, justifyContent: 'center', gap: space.md, backgroundColor: t.bg, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
        <T size={22} weight="700">This link is protected</T>
        <T muted>Enter the password the person who shared it gave you.</T>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
          onSubmitEditing={() => void load(password)}
          placeholder="Password"
          placeholderTextColor={t.muted}
          style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 }}
          accessibilityLabel="Password"
        />
        {error ? <T size={14} style={{ color: t.danger }}>{error}</T> : null}
        <Button label="Open" onPress={() => void load(password)} disabled={!password} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, padding: space.xl, justifyContent: 'center', gap: space.md, backgroundColor: t.bg }}>
        <T size={22} weight="700">Can’t open these notes</T>
        <T muted>{error}</T>
      </View>
    );
  }
  if (!data) return <ActivityIndicator style={{ flex: 1 }} color={t.accent} />;
  const n = data.notes;
  const date = new Date(n.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.xl, gap: space.xl, paddingBottom: 64 }}>
      <View style={{ gap: space.xs }}>
        <T size={28} weight="700">{n.title}</T>
        <T muted>{date}{n.duration_ms ? ` · ${minutes(n.duration_ms)}` : ''}</T>
      </View>
      {data.clip && <T muted>Clip {clock(data.clip.start_ms)}–{clock(data.clip.end_ms)}</T>}
      {data.audio.length > 0 && <SharedAudio parts={data.audio} clip={data.clip} />}
      {!!n.overview && <T size={17}>{n.overview}</T>}
      {data.can_ask && <AskBox token={token ?? ''} password={tried} />}

      {n.tasks.length > 0 && (
        <Section title="Next steps">
          {n.tasks.map((task, i) => (
            <T key={i}>
              {task.done ? '✓ ' : '•  '}
              {task.text}
              {task.owner || task.due ? <T muted> — {[task.owner, task.due && `due ${task.due}`].filter(Boolean).join(', ')}</T> : null}
            </T>
          ))}
        </Section>
      )}
      {n.decisions.length > 0 && (
        <Section title="Decisions">
          {n.decisions.map((d, i) => (
            <Card key={i} style={{ gap: 4 }}>
              <T weight="600">{d.text}</T>
              {d.quote ? <T muted size={13} style={{ fontStyle: 'italic' }}>“{d.quote}”</T> : null}
            </Card>
          ))}
        </Section>
      )}
      {n.site_log.map((s) => (
        <Section key={s.title} title={s.title} danger={s.title === 'Safety'}>
          {s.items.map((x, i) => <T key={i}>•  {x}</T>)}
        </Section>
      ))}
      {data.photos.length > 0 && (
        <Section title="Photos">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {data.photos.map((p, i) => (
              <View key={i} style={{ width: '48%', gap: 4 }}>
                <Image source={{ uri: p.url }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 8 }} resizeMode="cover" accessibilityLabel={p.caption ?? 'Photo'} />
                {p.caption ? <T muted size={12}>{p.caption}</T> : null}
              </View>
            ))}
          </View>
        </Section>
      )}
      {n.key_points.length > 0 && (
        <Section title="Key points">
          {n.key_points.map((k, i) => <T key={i}>•  {k}</T>)}
        </Section>
      )}
      {n.open_questions.length > 0 && (
        <Section title="Open questions">
          {n.open_questions.map((q, i) => <T key={i}>•  {q}</T>)}
        </Section>
      )}
      {n.transcript && (
        <Section title="Transcript">
          {n.transcript.map((l, i) => (
            <View key={i} style={{ gap: 2 }}>
              {(i === 0 || n.transcript![i - 1].speaker !== l.speaker) && (
                <T size={13} weight="700" style={{ color: t.accent, marginTop: space.sm }}>{l.speaker}  <T muted size={12}>{l.at}</T></T>
              )}
              <T>{l.text}</T>
            </View>
          ))}
        </Section>
      )}
      <T muted size={12}>AI-generated notes from a recording, checked against the transcript. Shared with {data.app}.</T>
    </ScrollView>
  );
}

function AskBox({ token, password }: { token: string; password?: string }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  async function ask() {
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setQ('');
    try {
      const r = await publicCall<{ answer: string }>('share/ask', { method: 'POST', body: { token, question }, password });
      setAnswers((x) => [...x, { q: question, a: r.answer }]);
    } catch (e) {
      setAnswers((x) => [...x, { q: question, a: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: space.sm }}>
      <T weight="600">Ask about this meeting</T>
      {answers.map((x, i) => (
        <View key={i} style={{ gap: 2 }}>
          <T size={14} weight="600">{x.q}</T>
          <T size={14}>{x.a}</T>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={ask}
          placeholder="e.g. When does the steel arrive?"
          placeholderTextColor={t.muted}
          style={{ flex: 1, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15, minHeight: 44 }}
          accessibilityLabel="Question"
        />
        <Button label="Ask" onPress={ask} loading={busy} disabled={!q.trim()} />
      </View>
    </Card>
  );
}

function Section({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <T size={13} weight="700" style={{ color: danger ? t.danger : t.muted }}>{title.toUpperCase()}</T>
      {children}
    </View>
  );
}
