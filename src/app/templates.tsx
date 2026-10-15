import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { currentUserId, deleteTemplate, listTemplates, listWorkspaces, saveTemplate } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import { TEMPLATE_LABELS, type SummaryTemplate, type Template, type Workspace } from '@/lib/types';

type Draft = { id?: string; name: string; instructions: string; base: Template; workspace_id: string | null };
const EMPTY: Draft = { name: '', instructions: '', base: 'meeting', workspace_id: null };

const EXAMPLE = `Sections: Schedule, Budget, RFIs and submittals, Risks.
Start with a one-line status (on track / at risk).
Use the client's terms: "change order", not "scope change".`;

/** Your own note formats, on top of the built-in types. Team templates are shared with every member. */
export default function Templates() {
  const t = useTheme();
  const [items, setItems] = useState<SummaryTemplate[]>([]);
  const [teams, setTeams] = useState<Workspace[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listTemplates());
    } catch (e) {
      notify("Couldn't load templates", (e as Error).message);
    }
  }, []);

  useEffect(() => {
    listTemplates()
      .then(setItems)
      .catch((e) => notify("Couldn't load templates", (e as Error).message));
    listWorkspaces().then(setTeams).catch(() => setTeams([]));
    currentUserId().then(setMe);
  }, []);

  const adminTeams = teams.filter((w) => w.role !== 'member');
  const canEdit = (x: SummaryTemplate) => x.user_id === me || adminTeams.some((w) => w.id === x.workspace_id);
  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await saveTemplate(draft);
      setDraft(null);
      await load();
    } catch (e) {
      notify("Couldn't save", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
        <T muted size={13} weight="600">NAME</T>
        <TextInput value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="e.g. OAC meeting" placeholderTextColor={t.muted} maxLength={60} style={input} accessibilityLabel="Template name" />

        <T muted size={13} weight="600">BUILDS ON</T>
        <Chips<Template> options={Object.keys(TEMPLATE_LABELS) as Template[]} label={(k) => TEMPLATE_LABELS[k]} value={draft.base} onChange={(base) => setDraft({ ...draft, base })} />
        <T muted size={13}>Keeps that type’s rules (e.g. site walks still get a daily site log). Action items are always checked against the transcript.</T>

        <T muted size={13} weight="600">INSTRUCTIONS</T>
        <TextInput
          value={draft.instructions}
          onChangeText={(instructions) => setDraft({ ...draft, instructions })}
          placeholder={EXAMPLE}
          placeholderTextColor={t.muted}
          multiline
          maxLength={4000}
          style={[input, { minHeight: 160, textAlignVertical: 'top' }]}
          accessibilityLabel="Instructions"
        />
        <T muted size={12}>{draft.instructions.length}/4000</T>

        {(adminTeams.length > 0 || draft.workspace_id) && (
          <>
            <T muted size={13} weight="600">WHO CAN USE IT</T>
            <Chips<string>
              options={['', ...adminTeams.map((w) => w.id)]}
              label={(id) => (id ? `Team: ${teams.find((w) => w.id === id)?.name ?? 'team'}` : 'Just me')}
              value={draft.workspace_id ?? ''}
              onChange={(id) => setDraft({ ...draft, workspace_id: id || null })}
            />
          </>
        )}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Cancel" kind="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
          <Button label="Save" onPress={save} loading={busy} disabled={!draft.name.trim() || !draft.instructions.trim()} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <T muted>Describe how you want notes laid out for a kind of meeting. Pick the template when you record or import.</T>
      <Button label="New template" onPress={() => setDraft(EMPTY)} />
      {items.map((x) => (
        <Card key={x.id} style={{ gap: space.sm }}>
          <T weight="700">{x.name}</T>
          <T muted size={13}>
            {TEMPLATE_LABELS[x.base]} rules{x.workspace_id ? ` · shared with ${teams.find((w) => w.id === x.workspace_id)?.name ?? 'your team'}` : ' · just you'}
          </T>
          <T size={14} numberOfLines={3}>{x.instructions}</T>
          {canEdit(x) && (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Edit" kind="secondary" onPress={() => setDraft({ id: x.id, name: x.name, instructions: x.instructions, base: x.base, workspace_id: x.workspace_id })} style={{ flex: 1 }} />
              <Button
                label="Delete"
                kind="ghost"
                onPress={async () => {
                  if (!(await confirm(`Delete “${x.name}”?`, 'Recordings already made with it keep their notes.', 'Delete', true))) return;
                  await deleteTemplate(x.id).catch((e) => notify("Couldn't delete", (e as Error).message));
                  await load();
                }}
                style={{ flex: 1 }}
              />
            </View>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}

function Chips<K extends string>({ options, value, onChange, label }: { options: K[]; value: K; onChange: (k: K) => void; label: (k: K) => string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((k) => {
        const on = k === value;
        return (
          <Pressable
            key={k || 'none'}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(k)}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }}
          >
            <T size={14} style={{ color: on ? t.accent : t.ink }}>{label(k)}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
