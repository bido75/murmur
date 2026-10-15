import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { deleteAccount, getRetention, getSettings, saveRetention, saveSettings, type Retention, type Settings } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { STATES } from '@/lib/shared';
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

  useEffect(() => {
    getRetention().then(setRet).catch(() => setRet({ audio_retention_days: null, recording_retention_days: null }));
    getSettings().then(setSettings);
  }, []);

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
