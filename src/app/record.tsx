import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Card, T } from '@/components/ui';
import { getSettings, newRecording } from '@/lib/api';
import { clock } from '@/lib/format';
import { useSegmentedRecorder } from '@/lib/recorder';
import { radius, space, useTheme } from '@/lib/theme';
import { TEMPLATE_LABELS, type Template } from '@/lib/types';

const NOTICE = "Quick note: I'm recording this conversation so I can take accurate notes. Is everyone okay with that?";

export default function Record() {
  const t = useTheme();
  const rec = useSegmentedRecorder();
  const [template, setTemplate] = useState<Template>('meeting');
  const [needConsent, setNeedConsent] = useState(true);
  const [consented, setConsented] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setTemplate(s.defaultTemplate);
      setNeedConsent(s.consentReminder);
    });
  }, []);

  async function start() {
    setStarting(true);
    try {
      const id = await newRecording({
        template,
        source: 'mic',
        consentAt: consented ? new Date().toISOString() : null,
      });
      setRecordingId(id);
      await rec.start(id);
    } catch (e) {
      Alert.alert("Couldn't start recording", (e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  function confirmStop() {
    Alert.alert('Stop recording?', 'Your notes will be ready in a minute or two.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          await rec.stop();
          if (recordingId) router.replace({ pathname: '/recording/[id]', params: { id: recordingId } });
          else router.back();
        },
      },
    ]);
  }

  const live = rec.phase !== 'idle';

  if (!live) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
          <View style={styles.headerRow}>
            <T size={28} weight="700">New recording</T>
            <Button label="Cancel" kind="ghost" onPress={() => router.back()} />
          </View>

          <View style={{ gap: space.sm }}>
            <T muted size={13} weight="600">WHAT IS IT?</T>
            <View style={styles.chips}>
              {(Object.keys(TEMPLATE_LABELS) as Template[]).map((k) => {
                const on = k === template;
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setTemplate(k)}
                    style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
                  >
                    <T size={15} weight={on ? '600' : '400'} style={{ color: on ? t.accent : t.ink }}>{TEMPLATE_LABELS[k]}</T>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {needConsent && (
            <Card style={{ gap: space.md }}>
              <T weight="600">Let people know</T>
              <T muted size={14}>
                Many places require everyone's permission to record, and some US states require it from every person on a call. You can say:
              </T>
              <T size={15} style={{ fontStyle: 'italic' }}>“{NOTICE}”</T>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consented }}
                onPress={() => setConsented((c) => !c)}
                style={styles.checkRow}
              >
                <View style={[styles.box, { borderColor: consented ? t.accent : t.muted, backgroundColor: consented ? t.accent : 'transparent' }]}>
                  {consented && <T size={13} weight="800" style={{ color: '#fff' }}>✓</T>}
                </View>
                <T style={{ flex: 1 }}>Everyone being recorded knows and agrees</T>
              </Pressable>
            </Card>
          )}

          <Button label="Start recording" onPress={start} loading={starting} disabled={needConsent && !consented} />
          <T muted size={13} style={{ textAlign: 'center' }}>
            Keeps recording with the screen locked. Audio is saved every 5 minutes, so nothing is lost if your phone dies.
          </T>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Level meter: map roughly -60..0 dBFS to 0..1
  const level = rec.level == null ? 0 : Math.max(0, Math.min(1, (rec.level + 60) / 60));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.live}>
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <View style={[styles.liveDot, { backgroundColor: rec.phase === 'recording' ? t.record : t.muted }]} />
          <T muted size={15}>{rec.phase === 'paused' ? 'Paused' : rec.phase === 'stopping' ? 'Saving…' : `Recording · ${TEMPLATE_LABELS[template]}`}</T>
        </View>

        <T size={64} weight="300" style={{ fontVariant: ['tabular-nums'], textAlign: 'center' }}>{clock(rec.elapsedMs)}</T>

        <View style={[styles.meterTrack, { backgroundColor: t.border }]} accessibilityLabel="Microphone level">
          <View style={[styles.meterFill, { width: `${level * 100}%`, backgroundColor: t.accent }]} />
        </View>

        <T muted size={13} style={{ textAlign: 'center' }}>
          {rec.segmentsSaved > 0 ? `${rec.segmentsSaved} part${rec.segmentsSaved > 1 ? 's' : ''} saved safely` : 'Saving as you go'}
        </T>

        {rec.warning && <Banner text={rec.warning} action={{ label: 'Restart mic', onPress: () => void rec.restartMic() }} />}
      </View>

      <View style={styles.controls}>
        {rec.phase === 'paused' ? (
          <Button label="Resume" kind="secondary" onPress={rec.resume} style={{ flex: 1 }} />
        ) : (
          <Button label="Pause" kind="secondary" onPress={rec.pause} disabled={rec.phase !== 'recording'} style={{ flex: 1 }} />
        )}
        <Button label="Stop" kind="danger" onPress={confirmStop} disabled={rec.phase === 'stopping'} style={{ flex: 1 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  live: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  liveDot: { width: 14, height: 14, borderRadius: 7 },
  meterTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  controls: { flexDirection: 'row', gap: space.md, padding: space.xl },
});
