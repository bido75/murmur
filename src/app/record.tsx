import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionMenu } from '@/components/ActionMenu';
import { ProjectPicker } from '@/components/ProjectPicker';
import { Banner, Button, Card, T } from '@/components/ui';
import { attachConsentRequest, createConsentRequest, getSettings, listTemplates, newRecording, openProjectTasks } from '@/lib/api';
import { APP_URL } from '@/lib/config';
import { consentAdvice, STATES } from '@/lib/shared';
import { confirm, isWeb, notify, shareOrCopy } from '@/lib/dialog';
import { queuePhoto, takePhoto } from '@/lib/photos';
import { clock } from '@/lib/format';
import { useSegmentedRecorder } from '@/lib/recorder';
import { radius, space, useTheme } from '@/lib/theme';
import { CONSENT_LABELS, TEMPLATE_LABELS, type ConsentMethod, type SummaryTemplate, type Task, type Template } from '@/lib/types';

// White text stays readable on it in light and dark themes.
const PAUSE_GRAY = '#3A3F3B';

const NOTICE = "Quick note: I'm recording this conversation so I can take accurate notes. Is everyone okay with that?";

export default function Record() {
  const t = useTheme();
  const rec = useSegmentedRecorder();
  const [template, setTemplate] = useState<Template>('meeting');
  const params = useLocalSearchParams<{ projectId?: string; title?: string; eventKey?: string }>();
  const [projectId, setProjectId] = useState<string | null>(params.projectId ?? null);
  const [briefFor, setBriefFor] = useState<{ projectId: string; tasks: Task[] } | null>(null);
  const brief = projectId && briefFor?.projectId === projectId ? briefFor.tasks : [];
  const [needConsent, setNeedConsent] = useState(true);
  const [consent, setConsent] = useState<ConsentMethod | null>(null);
  const consented = consent !== null;
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [field, setField] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [shooting, setShooting] = useState(false);
  const [micMenu, setMicMenu] = useState(false);
  const [custom, setCustom] = useState<SummaryTemplate[]>([]);
  const [customId, setCustomId] = useState<string | null>(null);
  const [myState, setMyState] = useState<string | null>(null);
  const [otherState, setOtherState] = useState<string | null>(null);
  const [otherQuery, setOtherQuery] = useState('');
  const [consentToken, setConsentToken] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((s) => {
      setTemplate(s.defaultTemplate);
      setNeedConsent(s.consentReminder);
      setField(s.fieldMode);
      setMyState(s.myState);
    });
    listTemplates().then(setCustom).catch(() => setCustom([]));
  }, []);

  const isCall = template === 'phone_call';
  const advice = consentAdvice(myState, isCall ? [otherState] : [], isCall ? 'phone' : 'in_person');
  const otherMatches = otherQuery.trim() ? STATES.filter((x) => x.name.toLowerCase().startsWith(otherQuery.trim().toLowerCase())).slice(0, 5) : [];

  async function sendConsentLink() {
    try {
      const base = APP_URL || (isWeb ? window.location.origin : '');
      if (!base) throw new Error('Set EXPO_PUBLIC_APP_URL so the link has somewhere to open.');
      const name = params.title || TEMPLATE_LABELS[template];
      const token = consentToken ?? (await createConsentRequest(name));
      setConsentToken(token);
      await shareOrCopy(`I'd like to record "${name}" for accurate notes. Please let me know if that's OK: ${base}/c/${token}`, 'Consent link copied');
    } catch (e) {
      notify("Couldn't make a consent link", (e as Error).message);
    }
  }

  const tap = () => {
    if (!isWeb) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  /** Take a photo; it's pinned to the moment the shutter closed and uploads with the recording. */
  async function photo() {
    if (!recordingId || shooting) return;
    tap();
    setShooting(true);
    try {
      const shot = await takePhoto('camera');
      if (!shot) return;
      const id = await queuePhoto(recordingId, shot, rec.elapsedMs);
      setPhotos((p) => [...p, { id, uri: shot.uri }]);
    } catch (e) {
      notify("Couldn't take the photo", (e as Error).message);
    } finally {
      setShooting(false);
    }
  }

  // The brief: what's still open in this project, so you can raise it in the meeting.
  useEffect(() => {
    if (!projectId) return;
    openProjectTasks(projectId)
      .then((tasks) => setBriefFor({ projectId, tasks }))
      .catch(() => setBriefFor({ projectId, tasks: [] }));
  }, [projectId]);

  async function start() {
    setStarting(true);
    try {
      const id = await newRecording({
        template,
        source: 'mic',
        consentAt: consented ? new Date().toISOString() : null,
        consentMethod: consent ?? 'not_confirmed',
        projectId,
        title: params.title || undefined,
        calendarEventKey: params.eventKey || null,
        customTemplateId: customId,
      });
      setRecordingId(id);
      await rec.start(id);
      // Responses to the consent link show on the recording. Needs a connection; retried by nothing,
      // so a failure here only means responses aren't linked (they're still saved).
      if (consentToken) setTimeout(() => void attachConsentRequest(consentToken, id).catch(() => {}), 4000);
    } catch (e) {
      notify("Couldn't start recording", (e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function confirmStop() {
    tap();
    const ok = await confirm('Stop recording?', 'Your notes will be ready in a minute or two.', 'Stop', true);
    if (!ok) return;
    await rec.stop();
    if (recordingId) router.replace({ pathname: '/recording/[id]', params: { id: recordingId } });
    else router.back();
  }

  const live = rec.phase !== 'idle';

  if (!live) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
          <View style={styles.headerRow}>
            <T size={28} weight="700" numberOfLines={2} style={{ flex: 1 }}>{params.title || 'New recording'}</T>
            <Button label="Cancel" kind="ghost" onPress={() => router.back()} />
          </View>

          <View style={{ gap: space.sm }}>
            <T muted size={13} weight="600">WHAT IS IT?</T>
            <View style={styles.chips}>
              {(Object.keys(TEMPLATE_LABELS) as Template[]).map((k) => {
                const on = k === template && !customId;
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => { setTemplate(k); setCustomId(null); }}
                    style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
                  >
                    <T size={15} weight={on ? '600' : '400'} style={{ color: on ? t.accent : t.ink }}>{TEMPLATE_LABELS[k]}</T>
                  </Pressable>
                );
              })}
              {custom.map((c) => {
                const on = c.id === customId;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => { setTemplate(c.base); setCustomId(c.id); }}
                    style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface, borderStyle: 'dashed' }]}
                  >
                    <T size={15} weight={on ? '600' : '400'} style={{ color: on ? t.accent : t.ink }}>{c.name}</T>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <T muted size={13} weight="600">PROJECT</T>
            <ProjectPicker value={projectId} onChange={setProjectId} />
          </View>

          {brief.length > 0 && (
            <Card style={{ gap: space.sm }}>
              <T weight="600">Still open in this project ({brief.length})</T>
              {brief.slice(0, 6).map((task) => (
                <T key={task.id} size={14}>
                  •  {task.text}{task.owner ? ` — ${task.owner}` : ''}
                </T>
              ))}
              {brief.length > 6 && <T muted size={13}>and {brief.length - 6} more</T>}
              <T muted size={13}>If these come up, your notes will mark them done or updated, with the quote as proof.</T>
            </Card>
          )}

          {needConsent && (
            <Card style={{ gap: space.md, borderColor: advice.level === 'everyone' ? t.danger : t.border }}>
              <T weight="600">Let people know</T>
              {isCall && (
                <View style={{ gap: space.xs }}>
                  <T size={14}>Where is the other person?</T>
                  <TextInput
                    value={otherState ? STATES.find((x) => x.code === otherState)?.name ?? 'Outside the US' : otherQuery}
                    onChangeText={(v) => { setOtherState(null); setOtherQuery(v); }}
                    placeholder="Type a US state"
                    placeholderTextColor={t.muted}
                    style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.md, padding: space.sm, color: t.ink, fontSize: 15 }}
                    accessibilityLabel="Other person's state"
                  />
                  {otherMatches.map((x) => (
                    <Pressable key={x.code} onPress={() => { setOtherState(x.code); setOtherQuery(''); }}>
                      <T size={14} style={{ color: t.accent }}>{x.name}</T>
                    </Pressable>
                  ))}
                  {!otherState && <Pressable onPress={() => setOtherState('OTHER')}><T size={14} style={{ color: t.accent }}>Outside the US / not sure</T></Pressable>}
                </View>
              )}
              <View style={{ gap: 2 }}>
                <T size={15} weight="600" style={{ color: advice.level === 'everyone' ? t.danger : t.ink }}>{advice.title}</T>
                <T muted size={14}>{advice.body}</T>
                {!myState && <T muted size={13}>Set where you usually record in Settings → Privacy & data for a precise warning.</T>}
              </View>
              <T muted size={14}>You can say:</T>
              <T size={15} style={{ fontStyle: 'italic' }}>“{NOTICE}”</T>
              <Button label={consentToken ? 'Share the consent link again' : 'Send a consent link'} kind="ghost" onPress={sendConsentLink} />
              {(['told_everyone', 'in_invite', ...(consentToken ? ['consent_link'] : []), 'solo'] as ConsentMethod[]).map((m) => {
                const on = consent === m;
                return (
                  <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setConsent(m)} style={styles.checkRow}>
                    <View style={[styles.radio, { borderColor: on ? t.accent : t.muted }]}>
                      {on && <View style={[styles.radioDot, { backgroundColor: t.accent }]} />}
                    </View>
                    <T style={{ flex: 1 }}>{CONSENT_LABELS[m]}</T>
                  </Pressable>
                );
              })}
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
  const mic = rec.inputs.find((i) => i.uid === rec.inputUid);
  const big = field; // field mode: glove-sized controls, bigger type

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.live, big && { gap: space.lg }]}>
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <View style={[styles.liveDot, { backgroundColor: rec.phase === 'recording' ? t.record : t.muted }]} />
          <T muted size={big ? 18 : 15}>{rec.phase === 'paused' ? 'Paused' : rec.phase === 'stopping' ? 'Saving…' : `Recording · ${TEMPLATE_LABELS[template]}`}</T>
        </View>

        <T size={big ? 76 : 64} weight="300" style={{ fontVariant: ['tabular-nums'], textAlign: 'center' }}>{clock(rec.elapsedMs)}</T>

        <View style={[styles.meterTrack, { backgroundColor: t.border, height: big ? 12 : 6 }]} accessibilityLabel="Microphone level">
          <View style={[styles.meterFill, { width: `${level * 100}%`, backgroundColor: t.accent, height: big ? 12 : 6 }]} />
        </View>

        <T muted size={big ? 16 : 13} style={{ textAlign: 'center' }}>
          {rec.segmentsSaved > 0 ? `${rec.segmentsSaved} part${rec.segmentsSaved > 1 ? 's' : ''} saved safely` : 'Saving as you go'}
          {photos.length ? ` · ${photos.length} photo${photos.length > 1 ? 's' : ''}` : ''}
        </T>

        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {photos.map((p) => (
              <Image key={p.id} source={{ uri: p.uri }} style={[styles.thumb, big && styles.thumbBig, { borderColor: t.border }]} resizeMode="cover" accessibilityLabel="Photo taken during this recording" />
            ))}
          </ScrollView>
        )}

        {rec.inputs.length > 1 && (
          <Pressable onPress={() => setMicMenu(true)} accessibilityRole="button" accessibilityLabel="Choose microphone" style={[styles.micRow, { borderColor: t.border }]}>
            <T size={big ? 17 : 14}>Mic: {mic?.name ?? 'Default'}</T>
            <T size={big ? 17 : 14} weight="600" style={{ color: t.accent }}>Change</T>
          </Pressable>
        )}

        {rec.warning && <Banner text={rec.warning} action={{ label: 'Restart mic', onPress: () => void rec.restartMic() }} />}
      </View>

      {big ? (
        <View style={styles.fieldControls}>
          <BigButton label={shooting ? 'Opening camera…' : 'Take photo'} color={t.accent} onPress={photo} disabled={rec.phase === 'stopping' || shooting} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {rec.phase === 'paused' ? (
              <BigButton label="Resume" color={PAUSE_GRAY} onPress={() => { tap(); rec.resume(); }} style={{ flex: 1 }} />
            ) : (
              <BigButton label="Pause" color={PAUSE_GRAY} onPress={() => { tap(); rec.pause(); }} disabled={rec.phase !== 'recording'} style={{ flex: 1 }} />
            )}
            <BigButton label="Stop" color={t.danger} onPress={confirmStop} disabled={rec.phase === 'stopping'} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ padding: space.xl, gap: space.md }}>
          <Button label={shooting ? 'Opening camera…' : 'Take photo'} kind="secondary" onPress={photo} disabled={rec.phase === 'stopping' || shooting} />
          <View style={styles.controls}>
            {rec.phase === 'paused' ? (
              <Button label="Resume" kind="secondary" onPress={rec.resume} style={{ flex: 1 }} />
            ) : (
              <Button label="Pause" kind="secondary" onPress={rec.pause} disabled={rec.phase !== 'recording'} style={{ flex: 1 }} />
            )}
            <Button label="Stop" kind="danger" onPress={confirmStop} disabled={rec.phase === 'stopping'} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      <ActionMenu
        visible={micMenu}
        title="Record from"
        onClose={() => setMicMenu(false)}
        actions={rec.inputs.map((i) => ({ label: i.uid === rec.inputUid ? `${i.name} ✓` : i.name, onPress: () => void rec.chooseInput(i.uid) }))}
      />
    </SafeAreaView>
  );
}

/** Glove-sized button for field mode: at least 88 pt tall, big label, haptic on press. */
function BigButton({ label, color, onPress, disabled, style }: { label: string; color: string; onPress: () => void; disabled?: boolean; style?: object }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.bigButton, { backgroundColor: color, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      <Text style={styles.bigLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  live: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  liveDot: { width: 14, height: 14, borderRadius: 7 },
  meterTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  controls: { flexDirection: 'row', gap: space.md },
  fieldControls: { gap: space.md, padding: space.lg },
  bigButton: { minHeight: 88, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  bigLabel: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  thumbBig: { width: 72, height: 72 },
  micRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
});
