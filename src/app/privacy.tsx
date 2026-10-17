import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { localSttSupported, MODEL_MB, deleteModel, downloadModel, modelReady } from '@/lib/localStt';
import { ToggleRow } from '@/components/ToggleRow';
import { auditEvents, exportMyData, type AuditEvent, deleteAccount, getRetention, getSettings, getTranscriptionSettings, saveRetention, saveSettings, saveTranscriptionSettings, type Retention, type Settings, type Transcription } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { LANGUAGES, STATES } from '@/lib/shared';
import { radius, space, useTheme } from '@/lib/theme';

const AUDIO: { label: string; days: number | null }[] = [
  { label: 'Forever', days: null },
  { label: '1 year', days: 365 },
  { label: '90 days', days: 90 },
  { label: '30 days', days: 30 },
  { label: '7 days', days: 7 },
];
const ALL: { label: string; days: number | null }[] = [
  { label: 'Forever', days: null },
  { label: '3 years', days: 1095 },
  { label: '1 year', days: 365 },
  { label: '90 days', days: 90 },
];

export default function Privacy() {
  const t = useTheme();
  const [ret, setRet] = useState<Retention | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [stateQuery, setStateQuery] = useState('');
  const [stt, setStt] = useState<Transcription | null>(null);
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => {
    getRetention().then(setRet).catch(() => setRet({ audio_retention_days: null, recording_retention_days: null }));
    getSettings().then(setSettings);
    getTranscriptionSettings().then(setStt).catch(() => setStt({ language: null, redact: [] }));
  }, []);

  function updateStt(patch: Partial<Transcription>) {
    if (!stt) return;
    const next = { ...stt, ...patch };
    setStt(next);
    void saveTranscriptionSettings(next).catch((e) => notify("Couldn't save", (e as Error).message));
  }
  const REDACT: { key: string; label: string }[] = [
    { key: 'pii', label: 'Personal details (names, emails, phone numbers, addresses)' },
    { key: 'phi', label: 'Health information' },
    { key: 'pci', label: 'Card and bank numbers' },
    { key: 'numbers', label: 'All long numbers' },
  ];
  const langLabel = !stt?.language ? 'Detect automatically' : stt.language === 'multi' ? 'Several languages in one recording' : LANGUAGES.find((l) => l.code === stt.language)?.name ?? stt.language;

  async function update(patch: Partial<Retention>) {
    if (!ret) return;
    const next = { ...ret, ...patch };
    const shorter = (a: number | null, b: number | null) => a != null && (b == null || a < b);
    if (shorter(patch.audio_retention_days ?? null, ret.audio_retention_days) || shorter(patch.recording_retention_days ?? null, ret.recording_retention_days)) {
      const ok = await confirm(
        'Delete older material?',
        'Anything older than this is deleted permanently at the next daily cleanup, including recordings in team projects you made.',
        'Apply',
        true,
      );
      if (!ok) return;
    }
    setRet(next);
    await saveRetention(next).catch((e) => notify("Couldn't save", (e as Error).message));
  }

  function setPlace(code: string) {
    if (!settings) return;
    const next = { ...settings, myState: code };
    setSettings(next);
    void saveSettings(next);
  }

  async function removeAccount() {
    const ok = await confirm('Delete your account?', 'All your recordings, transcripts, notes, photos and connections are deleted. This can’t be undone.', 'Delete forever', true);
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteAccount();
      notify('Account deleted', 'Your account and data have been deleted.');
    } catch (e) {
      notify("Couldn't delete the account", (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  const matches = stateQuery.trim()
    ? STATES.filter((s) => s.name.toLowerCase().startsWith(stateQuery.trim().toLowerCase()) || s.code.toLowerCase() === stateQuery.trim().toLowerCase())
    : [];
  const current = settings?.myState === 'OTHER' ? 'Outside the US' : STATES.find((s) => s.code === settings?.myState)?.name;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <Card style={{ gap: space.md }}>
        <T size={18} weight="700">Where you usually record</T>
        <T muted size={14}>Used to warn you when the law there needs everyone’s permission to record. Information only, not legal advice.</T>
        <T size={15}>Now: <T size={15} weight="600">{current ?? 'Not set'}</T></T>
        <TextInput
          value={stateQuery}
          onChangeText={setStateQuery}
          placeholder="Type a US state"
          placeholderTextColor={t.muted}
          style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 }}
          accessibilityLabel="State"
        />
        {matches.slice(0, 6).map((s) => (
          <Pressable key={s.code} onPress={() => { setPlace(s.code); setStateQuery(''); }} accessibilityRole="button">
            <T style={{ color: t.accent }}>{s.name}{s.rule === 'all_party' ? ' · everyone must agree' : ''}</T>
          </Pressable>
        ))}
        <Button label="I’m outside the US" kind="ghost" onPress={() => setPlace('OTHER')} />
      </Card>

      <Card style={{ gap: space.md }}>
        <T size={18} weight="700">Transcription</T>
        <T size={15}>Language: <T size={15} weight="600">{langLabel}</T></T>
        <Button label={langOpen ? 'Close' : 'Change language'} kind="ghost" onPress={() => setLangOpen(!langOpen)} />
        {langOpen && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {[{ code: '', name: 'Detect automatically' }, { code: 'multi', name: 'Several languages' }, ...LANGUAGES].map((l) => (
              <Pressable
                key={l.code || 'auto'}
                onPress={() => { updateStt({ language: l.code || null }); setLangOpen(false); }}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: (stt?.language ?? '') === l.code ? t.accent : t.border }}
              >
                <T size={13}>{l.name}</T>
              </Pressable>
            ))}
          </View>
        )}
        <T muted size={14}>Remove from transcripts (and so from notes):</T>
        {REDACT.map((r) => {
          const on = !!stt?.redact.includes(r.key);
          return (
            <Pressable key={r.key} onPress={() => updateStt({ redact: on ? stt!.redact.filter((x) => x !== r.key) : [...(stt?.redact ?? []), r.key] })} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: on ? t.accent : t.muted, backgroundColor: on ? t.accent : 'transparent' }} />
              <T style={{ flex: 1 }} size={15}>{r.label}</T>
            </Pressable>
          );
        })}
        <T muted size={12}>Removed details appear as tags like [PII]. Applies to new recordings and re-runs.</T>
      </Card>

      {localSttSupported() && settings && <OnDeviceCard settings={settings} onChange={(s) => { setSettings(s); void saveSettings(s); }} />}

      <Card style={{ gap: space.md }}>
        <T size={18} weight="700">Keep audio for</T>
        <T muted size={14}>After this, the audio files are deleted. Transcripts, notes and tasks stay.</T>
        <Options options={AUDIO} value={ret?.audio_retention_days ?? null} onChange={(d) => void update({ audio_retention_days: d })} />
      </Card>

      <Card style={{ gap: space.md }}>
        <T size={18} weight="700">Keep recordings for</T>
        <T muted size={14}>After this, the whole recording is deleted: audio, photos, transcript, notes and tasks.</T>
        <Options options={ALL} value={ret?.recording_retention_days ?? null} onChange={(d) => void update({ recording_retention_days: d })} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T size={18} weight="700">How your data is used</T>
        <T size={14}>• Audio is transcribed by Deepgram and notes are written by Claude (Anthropic). Neither is allowed to train on your recordings.</T>
        <T size={14}>• Everything is private to you unless you put it in a team project or share a link.</T>
        <T size={14}>• Shared links can be turned off at any time.</T>
      </Card>

      <ExportCard />
      <ActivityCard />

      <Card style={{ gap: space.md, borderColor: t.danger }}>
        <T size={18} weight="700" style={{ color: t.danger }}>Delete account</T>
        <T muted size={14}>
          Deletes your account and everything you made. Team projects you created are handed to another team admin so your teammates keep their work. If you’re the
          only owner of a team with other people in it, make someone else an owner first.
        </T>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder="Type DELETE to confirm"
          placeholderTextColor={t.muted}
          autoCapitalize="characters"
          style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 }}
          accessibilityLabel="Type DELETE to confirm"
        />
        <Button label="Delete my account" kind="danger" onPress={removeAccount} loading={deleting} disabled={typed.trim() !== 'DELETE'} />
      </Card>
    </ScrollView>
  );
}

function Options({ options, value, onChange }: { options: { label: string; days: number | null }[]; value: number | null; onChange: (d: number | null) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => {
        const on = o.days === value;
        return (
          <Pressable
            key={o.label}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.days)}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }}
          >
            <T size={14} style={{ color: on ? t.accent : t.ink }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Transcribe on this phone: audio never leaves it; only text is sent for notes. */
function OnDeviceCard({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [ready, setReady] = useState(modelReady());
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      await downloadModel();
      setReady(true);
      onChange({ ...settings, onDevice: true });
    } catch (e) {
      notify("Couldn't download", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: space.md }}>
      <T size={18} weight="700">Transcribe on this phone</T>
      <T muted size={14}>
        The audio never leaves your phone — only the text is sent to make notes. Slower, uses battery, no speaker names, less accurate in noisy places{Platform.OS === 'android' ? ', and the app must stay open while recording' : ''}. Uses the transcription language above.
      </T>
      {ready ? (
        <>
          <ToggleRow label="Transcribe new recordings on this phone" value={settings.onDevice} onChange={(v) => onChange({ ...settings, onDevice: v })} />
          <Button label="Remove the speech model" kind="ghost" onPress={() => { deleteModel(); setReady(false); onChange({ ...settings, onDevice: false }); }} />
        </>
      ) : (
        <Button label={`Download the speech model (${MODEL_MB} MB)`} kind="secondary" onPress={download} loading={busy} />
      )}
    </Card>
  );
}

function ExportCard() {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await exportMyData();
      if (await confirm('Your export is ready', `${r.recordings} recording${r.recordings === 1 ? '' : 's'}${r.truncated ? ' (the oldest 2,000)' : ''}: notes, transcripts, tasks and audio links. The download link works for 24 hours.`, 'Download')) {
        await Linking.openURL(r.url);
      }
    } catch (e) {
      notify("Couldn't export", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: space.md }}>
      <T size={18} weight="700">Export my data</T>
      <T muted size={14}>A ZIP of everything you recorded — notes, transcripts and tasks as readable files and JSON, plus download links for the audio.</T>
      <Button label="Make my export" kind="secondary" onPress={run} loading={busy} />
    </Card>
  );
}

const PERSONAL: Record<string, string> = {
  'api_token.added': 'Created an API token',
  'api_token.removed': 'Revoked an API token',
  'device.added': 'Linked a device',
  'device.removed': 'Unlinked a device',
  'connection.added': 'Connected an app',
  'connection.removed': 'Disconnected an app',
  'share_link.created': 'Made a public link',
  'share_link.revoked': 'Turned off a public link',
  'recording.deleted': 'Deleted a recording',
  'data.exported': 'Exported data',
  'team.deleted': 'Deleted a team',
};

function ActivityCard() {
  const t = useTheme();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    auditEvents(null).then((e) => setEvents(e.slice(0, 15))).catch(() => setEvents([]));
  }, []);
  if (!events.length) return null;
  return (
    <Card style={{ gap: space.xs }}>
      <T size={18} weight="700">Security activity</T>
      {events.map((e) => {
        const m = e.meta as Record<string, string>;
        const what = m.name ?? m.provider ?? m.title ?? null;
        return (
          <View key={e.id} style={{ paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: t.border }}>
            <T size={15}>{PERSONAL[e.action] ?? e.action}{what ? `: ${what}` : ''}</T>
            <T muted size={12}>{new Date(e.created_at).toLocaleString()}</T>
          </View>
        );
      })}
    </Card>
  );
}
