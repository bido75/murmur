import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { Button, Card, Empty, T } from '@/components/ui';
import { createProject, listProjects, listWorkspaces } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import type { Project, Workspace } from '@/lib/types';

export default function Projects() {
  const t = useTheme();
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [teams, setTeams] = useState<Workspace[]>([]);
  const [owner, setOwner] = useState<string | null>(null); // null = personal

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, ws] = await Promise.all([listProjects(), listWorkspaces()]);
      setItems(ps);
      setTeams(ws);
    } catch (e) {
      notify("Couldn't load projects", (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function add() {
    if (!name.trim()) return;
    try {
      const p = await createProject(name, owner);
      setName('');
      setItems((xs) => [p, ...xs]);
    } catch (e) {
      notify("Couldn't create project", (e as Error).message);
    }
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.muted} />}
      ListHeaderComponent={
        <View style={{ gap: space.sm, marginBottom: space.sm }}>
        {teams.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {[{ id: null as string | null, name: 'Personal' }, ...teams].map((w) => {
              const on = owner === w.id;
              return (
                <Pressable
                  key={w.id ?? 'personal'}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setOwner(w.id)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : 'transparent' }}
                >
                  <T size={14} style={{ color: on ? t.accent : t.ink }}>{w.name}</T>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={add}
            placeholder="New project, e.g. a client or job site"
            placeholderTextColor={t.muted}
            style={{ flex: 1, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, minHeight: 48 }}
            accessibilityLabel="New project name"
          />
          <Button label="Add" onPress={add} disabled={!name.trim()} style={{ minHeight: 48 }} />
        </View>
        </View>
      }
      ListEmptyComponent={loading ? null : <Empty title="No projects yet" body="Group recordings by client, job site or team. Each new meeting picks up the tasks still open from the last one." />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}>
          <Card style={{ gap: 2 }}>
            <T size={17} weight="600">{item.name}</T>
            <T muted size={13}>{item.workspaces?.name ? `Team · ${item.workspaces.name}` : 'Personal'}</T>
          </Card>
        </Pressable>
      )}
    />
  );
}
