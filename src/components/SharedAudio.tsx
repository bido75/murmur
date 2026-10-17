import { useAudioPlayer } from 'expo-audio';
import { createElement } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui';
import { isWeb } from '@/lib/dialog';
import { space } from '@/lib/theme';

export type AudioPart = { url: string; start_ms: number; duration_ms: number };
type Clip = { start_ms: number; end_ms: number } | null;

/** Play the recording (or just the clip). Browser player on the web, a simple button on phones. */
export function SharedAudio({ parts, clip }: { parts: AudioPart[]; clip: Clip }) {
  // For a clip, only the part that contains its start is needed.
  const shown = clip ? parts.filter((p) => clip.start_ms >= p.start_ms && (!p.duration_ms || clip.start_ms < p.start_ms + p.duration_ms)).slice(0, 1) : parts;
  return (
    <View style={{ gap: space.sm }}>
      {shown.map((p, i) => {
        const from = clip ? Math.max(0, (clip.start_ms - p.start_ms) / 1000) : 0;
        const to = clip ? Math.max(from + 1, (clip.end_ms - p.start_ms) / 1000) : null;
        if (isWeb) {
          const src = to != null ? `${p.url}#t=${from.toFixed(1)},${to.toFixed(1)}` : p.url;
          return createElement('audio', { key: i, controls: true, preload: 'none', src, style: { width: '100%' } });
        }
        return <NativePlayer key={i} url={p.url} from={from} label={shown.length > 1 ? `Play part ${i + 1}` : 'Play'} />;
      })}
    </View>
  );
}

function NativePlayer({ url, from, label }: { url: string; from: number; label: string }) {
  const player = useAudioPlayer({ uri: url });
  return (
    <Button
      label={label}
      kind="secondary"
      onPress={async () => {
        await player.seekTo(from);
        player.play();
      }}
    />
  );
}

