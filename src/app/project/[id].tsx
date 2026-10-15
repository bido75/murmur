import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { ActionMenu } from '@/components/ActionMenu';
import { SendToTracker } from '@/components/SendToTracker';
import { TaskRow } from '@/components/TaskRow';
import { Button, Card, Empty, StatusPill, T } from '@/components/ui';
import { getProject, parseVocabulary, setProjectVocabulary, updateProject, updateTask } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { minutes, shortDate } from '@/lib/format';
import { radius, space, useTheme } from '@/lib/theme';
import { TEMPLATE_LABELS, type Task } from '@/lib/types';

type Data = Awaited<ReturnType<typeof getProject>>;

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [data, setData] = useState<Data | null>(null);
  const [name, setName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [words, setWords] = useState<string | null>(null); // null until loaded

  const load = useCallback(async () => {
    try {
      const d = await getProject(id);
      setData(d);
      if (d.project) {
        setName((n) => n || d.project!.name);
        setWords((w) => w ?? (d.project!.vocabulary ?? []).join(', '));
      }
    } catch (e) {
      notify("Couldn't load project", (e as Error).message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function patchTask(task: Task, change: Partial<Task>) {
    setData((d) => (d ? { ...d, openTasks: d.openTasks.filter((x) => x.id !== task.id) } : d));
    try {
      await updateTask(task.id, change);
    } catch (e) {
      notify("Couldn't update task", (e as Error).message);
      void load();
    }
  }

  const project = data?.project;

  async function saveWords() {
    if (!project || words == null) return;
    const list = parseVocabulary(words);
    if (list.join('|') === (project.vocabulary ?? []).join('|')) return;
    try {
      await setProjectVocabulary(project.id, list);
      setWords(list.join(', '));
      setData((d) => (d && d.project ? { ...d, project: { ...d.project, vocabulary: list } } : d));
    } catch (e) {
      notify("Couldn't save the words", (e as Error).message);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Project actions" hitSlop={12}>
              <T size={22} weight="700" style={{ color: t.accent }}>···</T>
            </Pressable>
          ),
        }}
      />
      {!data ? null : !project ? (
        <Empty title="Project not found" />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}>
          <TextInput
            value={name}
            onChangeText={setName}
            onEndEditing={() => name.trim() && name !== project.name && void updateProject(project.id, { name: name.trim() })}
            style={{ color: t.ink, fontSize: 26, fontWeight: '700' }}
            accessibilityLabel="Project name"
          />

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Button label="Record here" onPress={() => router.push({ pathname: '/record', params: { projectId: project.id } })} style={{ flex: 1 }} />
            <Button label="Make a deck" kind="secondary" onPress={() => router.push({ pathname: '/deck', params: { projectId: project.id } })} style={{ flex: 1 }} />
          </View>

          <View style={{ gap: space.sm }}>
            <T muted size={13} weight="600">OPEN TASKS ({data.openTasks.length})</T>
            {data.openTasks.length > 0 && <SendToTracker tasks={data.openTasks} onDone={load} />}
            {data.openTasks.length === 0 ? (
              <T muted>Nothing open. New tasks from this project’s recordings show up here.</T>
            ) : (
              data.openTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  source={task.recordings?.title}
                  onToggle={() => patchTask(task, { status: 'done' })}
                  onAccept={() => patchTask(task, { needs_review: false })}
                  onDismiss={() => patchTask(task, { status: 'dismissed' })}
                  onQuotePress={task.recording_id ? () => router.push({ pathname: '/recording/[id]', params: { id: task.recording_id! } }) : undefined}
                />
              ))
            )}
          </View>

          <View style={{ gap: space.sm }}>
            <T muted size={13} weight="600">WORDS TO LISTEN FOR</T>
            <T muted size={14}>
              Names, companies, products and site terms the transcriber should expect (e.g. Hilti, Apex Electric, level 3 riser). Separate with commas.
              Used for new recordings in this project.
            </T>
            <TextInput
              value={words ?? ''}
              onChangeText={setWords}
              onEndEditing={() => void saveWords()}
              onBlur={() => void saveWords()}
              placeholder="Hilti, Apex Electric, level 3 riser"
              placeholderTextColor={t.muted}
              multiline
              autoCapitalize="none"
              style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16, minHeight: 64 }}
              accessibilityLabel="Words to listen for"
            />
          </View>

          <View style={{ gap: space.md }}>
            <T muted size={13} weight="600">RECORDINGS ({data.recordings.length})</T>
            {data.recordings.map((r) => (
              <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/recording/[id]', params: { id: r.id } })}>
                <Card style={{ gap: space.xs }}>
                  <T weight="600" numberOfLines={2}>{r.title}</T>
                  <T muted size={13}>{shortDate(r.created_at)} · {TEMPLATE_LABELS[r.template]}{r.duration_ms ? ` · ${minutes(r.duration_ms)}` : ''}</T>
                  {r.status !== 'ready' && <StatusPill status={r.status} />}
                </Card>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
      <ActionMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            label: 'Archive project',
            destructive: true,
            onPress: async () => {
              if (!project) return;
              const ok = await confirm('Archive this project?', 'Its recordings and tasks stay; the project is hidden from lists.', 'Archive', true);
              if (!ok) return;
              await updateProject(project.id, { archived: true }).catch((e) => notify("Couldn't archive", (e as Error).message));
              router.back();
            },
          },
        ]}
      />
    </>
  );
}
