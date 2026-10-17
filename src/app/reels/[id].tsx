import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { ActionMenu } from '@/components/ActionMenu';
import { PromptModal, type Prompt } from '@/components/PromptModal';
import { ToggleRow } from '@/components/ToggleRow';
import { Button, Card, Empty, T } from '@/components/ui';
import { currentUserId, deleteReel, listReels, listWorkspaces, reelItems, reelUrl, removeReelItem, renameReel, setReelSharing, swapReelItems, type Reel, type ReelItem } from '@/lib/api';
import { confirm, notify, shareOrCopy } from '@/lib/dialog';
import { clock } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

export default function ReelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [reel, setReel] = useState<Reel | null>(null);
  const [items, setItems] = useState<ReelItem[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string }[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, list] = await Promise.all([listReels(), reelItems(id)]);
      setReel(all.find((r) => r.id === id) ?? null);
      setItems(list);
    } catch (e) {
      notify("Couldn't load the reel", (e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void Promise.all([listReels(), reelItems(id)])
      .then(([all, list]) => {
        setReel(all.find((r) => r.id === id) ?? null);
        setItems(list);
      })
      .catch((e) => notify("Couldn't load the reel", (e as Error).message));
    currentUserId().then(setMe).catch(() => undefined);
  }, [id]);

  if (!reel) return null;
  const mine = reel.user_id === me;
  const total = items.reduce((n, i) => n + (i.end_ms - i.start_ms), 0);

  async function share(on: boolean) {
    try {
      const tok = await setReelSharing(id, on);
      await load();
      if (tok) await shareOrCopy(reelUrl(tok), 'Link copied');
    } catch (e) {
      notify("Couldn't change sharing", (e as Error).message);
    }
  }

  async function chooseTeam() {
    const ws = await listWorkspaces();
    setTeams(ws.map((w) => ({ id: w.id, name: w.name })));
  }

  async function setTeam(wsId: string | null) {
    const { error } = await supabase.from('playlists').update({ workspace_id: wsId }).eq('id', id);
    if (error) notify("Couldn't save", error.message);
    await load();
  }

  return (
    <>
      <Stack.Screen options={{ title: reel.title }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <T muted>{items.length} clip{items.length === 1 ? '' : 's'} · {clock(total)}</T>
        {!items.length && <Empty title="No clips yet" body="Long-press a line in any transcript and choose “Add to a highlight reel”." />}
        {items.map((it, i) => (
          <Card key={it.id} style={{ gap: space.xs }}>
            <T weight="600">{it.title || it.recordings?.title || 'Clip'}</T>
            <T muted size={13}>{it.recordings?.title ?? ''} · {clock(it.start_ms)}–{clock(it.end_ms)}</T>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Button label="Play" kind="secondary" onPress={() => router.push({ pathname: '/recording/[id]', params: { id: it.recording_id, t: String(it.start_ms) } })} />
              {mine && i > 0 && <Button label="Move up" kind="ghost" onPress={() => void swapReelItems(it, items[i - 1]).then(load)} />}
              {mine && <Button label="Remove" kind="ghost" onPress={() => void removeReelItem(it.id).then(load)} />}
            </View>
          </Card>
        ))}
        {mine && (
          <Card style={{ gap: space.md }}>
            <ToggleRow
              label="Public link"
              hint="Anyone with the link can play these clips. Only clips from your own recordings are included, and team rules on public links apply."
              value={!!reel.share_token}
              onChange={(v) => void share(v)}
            />
            {reel.share_token && <Button label="Copy link" kind="ghost" onPress={() => void shareOrCopy(reelUrl(reel.share_token!), 'Link copied')} />}
            <Button label={reel.workspace_id ? 'Shared with a team · change' : 'Share with a team in the app'} kind="secondary" onPress={() => void chooseTeam()} />
            <Button label="Rename" kind="ghost" onPress={() => setPrompt({ title: 'Rename reel', initial: reel.title, onSubmit: async (v) => { if (v.trim()) { await renameReel(id, v); await load(); } } })} />
            <Button
              label="Delete reel"
              kind="ghost"
              onPress={() => void confirm('Delete this reel?', 'The recordings themselves are not affected.', 'Delete', true).then(async (ok) => { if (ok) { await deleteReel(id); router.back(); } })}
            />
          </Card>
        )}
        <T muted size={12} style={{ color: t.muted }}>Clips play inside their recording.</T>
      </ScrollView>
      <ActionMenu
        visible={!!teams}
        title="Who can see this reel in the app?"
        onClose={() => setTeams(null)}
        actions={[{ label: 'Only me', onPress: () => void setTeam(null) }, ...(teams ?? []).map((w) => ({ label: w.name, onPress: () => void setTeam(w.id) }))]}
      />
      <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />
    </>
  );
}
