import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PromptModal, type Prompt } from '@/components/PromptModal';
import { Button, Card, Empty, T } from '@/components/ui';
import { createReel, currentUserId, listReels, type Reel } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { space } from '@/lib/theme';

export default function Reels() {
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  useFocusEffect(
    useCallback(() => {
      listReels().then(setReels).catch((e) => notify("Couldn't load reels", (e as Error).message));
      currentUserId().then(setMe).catch(() => undefined);
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <T muted>Collect the moments that matter from different recordings — client feedback, safety talks, decisions — and share them as one reel.</T>
      <Button
        label="New reel"
        onPress={() =>
          setPrompt({
            title: 'Name the reel',
            placeholder: 'e.g. Client feedback, October',
            okLabel: 'Create',
            onSubmit: async (v) => {
              if (!v.trim()) return;
              const id = await createReel(v);
              router.push({ pathname: '/reels/[id]', params: { id } });
            },
          })
        }
      />
      {reels && !reels.length && <Empty title="No reels yet" body="In a transcript, long-press a line and choose “Add to a highlight reel”." />}
      {(reels ?? []).map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/reels/[id]', params: { id: r.id } })}>
          <Card style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
              <T weight="600" style={{ flex: 1 }}>{r.title}</T>
              {r.share_token && <T muted size={13}>Shared</T>}
            </View>
            <T muted size={13}>{r.user_id === me ? (r.workspace_id ? 'Yours · team can see it' : 'Yours') : 'From your team'}</T>
          </Card>
        </Pressable>
      ))}
      <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />
    </ScrollView>
  );
}
