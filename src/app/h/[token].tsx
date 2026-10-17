// A public highlight reel: clips from several recordings, each with its words and audio.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SharedAudio, type AudioPart } from '@/components/SharedAudio';
import { Card, T } from '@/components/ui';
import { publicCall, PublicError } from '@/lib/api';
import { clock } from '@/lib/format';
import { space, useTheme } from '@/lib/theme';

type Clip = { title: string; recording: string; date: string; clip: { start_ms: number; end_ms: number }; audio: AudioPart[]; lines: { at: string; speaker: string; text: string }[] };
type Payload = { title: string; clips: Clip[]; app: string };

export default function PublicReel() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTheme();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicCall<Payload>(`share/reel?token=${encodeURIComponent(token ?? '')}`)
      .then(setData)
      .catch((e) => setError(e instanceof PublicError ? e.message : 'Couldn’t load this reel.'));
  }, [token]);

  if (error) return <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: t.bg }}><T size={18} style={{ textAlign: 'center' }}>{error}</T></View>;
  if (!data) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.bg }}><ActivityIndicator /></View>;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.xl, gap: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <T size={28} weight="700">{data.title}</T>
      <T muted>{data.clips.length} clip{data.clips.length === 1 ? '' : 's'}</T>
      {data.clips.map((c, i) => (
        <Card key={i} style={{ gap: space.sm }}>
          <T weight="600">{i + 1}. {c.title}</T>
          <T muted size={13}>{c.recording} · {new Date(c.date).toLocaleDateString()} · {clock(c.clip.start_ms)}–{clock(c.clip.end_ms)}</T>
          {c.audio.length > 0 && <SharedAudio parts={c.audio} clip={c.clip} />}
          {c.lines.map((l, k) => (
            <T key={k} size={15}><T size={15} weight="600">{l.speaker}: </T>{l.text}</T>
          ))}
        </Card>
      ))}
      <T muted size={12}>Clips shared from {data.app}.</T>
    </ScrollView>
  );
}
