import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { ProjectPicker } from '@/components/ProjectPicker';
import { Button, T } from '@/components/ui';
import { getSettings, importFromLink } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { normalizeMediaLink } from '@/lib/shared';
import { radius, space, useTheme } from '@/lib/theme';
import type { Template } from '@/lib/types';

/** Paste a Dropbox, Google Drive, OneDrive or direct audio/video link. */
export default function ImportLink() {
  const t = useTheme();
  const [link, setLink] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [template, setTemplate] = useState<Template>('meeting');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings().then((s) => setTemplate(s.defaultTemplate));
  }, []);

  const check = link.trim() ? normalizeMediaLink(link) : null;

  async function go() {
    setBusy(true);
    try {
      const id = await importFromLink(link, template, projectId);
      router.replace({ pathname: '/recording/[id]', params: { id } });
    } catch (e) {
      notify("Couldn't import that link", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <T muted>Works with Dropbox, Google Drive and OneDrive share links (set to “anyone with the link”) and direct links to audio or video files.</T>
      <TextInput
        value={link}
        onChangeText={setLink}
        placeholder="https://…"
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 }}
        accessibilityLabel="Link to audio or video"
      />
      {check && !check.ok && <T size={14} style={{ color: t.danger }}>{check.reason}</T>}
      {check?.ok && <T size={14} style={{ color: t.accent }}>Looks good ({check.label}).</T>}
      <T muted size={13} weight="600">PROJECT</T>
      <ProjectPicker value={projectId} onChange={setProjectId} />
      <Button label="Import" onPress={go} loading={busy} disabled={!check?.ok} />
      <T muted size={13}>The file stays where it is; we read it to transcribe. If the link stops working later, the audio won’t play here, but the notes stay.</T>
    </ScrollView>
  );
}
