import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { ProjectPicker } from '@/components/ProjectPicker';
import { Button, Card, T } from '@/components/ui';
import { getBrief, linkEventToProject } from '@/lib/api';
import { dayLabel, timeRange } from '@/lib/calendarUi';
import { notify } from '@/lib/dialog';
import { shortDate } from '@/lib/format';
import { space, useTheme } from '@/lib/theme';

type Brief = Awaited<ReturnType<typeof getBrief>>;

export default function BriefScreen() {
  const t = useTheme();
  const p = useLocalSearchParams<{ key: string; title: string; start: string; end: string; url?: string; who?: string; projectId?: string }>();
  const [projectId, setProjectId] = useState<string | null>(p.projectId || null);
  const [brief, setBrief] = useState<{ projectId: string; data: Brief } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    getBrief(projectId)
      .then((data) => setBrief({ projectId, data }))
      .catch((e) => notify("Couldn't load the brief", (e as Error).message));
  }, [projectId]);

  async function choose(id: string | null) {
    setProjectId(id);
    try {
      await linkEventToProject(p.key, id);
    } catch (e) {
      notify("Couldn't save", (e as Error).message);
    }
  }

  const data = projectId && brief?.projectId === projectId ? brief.data : null;
  const decisions = data?.last?.summary?.decisions?.filter((d) => d.verified) ?? [];
  const questions = data?.last?.summary?.open_questions ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}>
      <View style={{ gap: space.xs }}>
        <T size={24} weight="700">{p.title}</T>
        <T muted>{dayLabel(p.start)} · {timeRange({ start: p.start, end: p.end })}</T>
        {p.who ? <T muted size={14}>With {p.who}</T> : null}
      </View>

      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Button
          label="Record this meeting"
          onPress={() => router.push({ pathname: '/record', params: { title: p.title, eventKey: p.key, ...(projectId ? { projectId } : {}) } })}
          style={{ flex: 1 }}
        />
        {p.url ? <Button label="Join" kind="secondary" onPress={() => void Linking.openURL(p.url!)} style={{ flex: 1 }} /> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <T muted size={13} weight="600">PROJECT FOR THIS MEETING</T>
        <ProjectPicker value={projectId} onChange={(id) => void choose(id)} />
        <T muted size={13}>Remembered for every meeting in this series.</T>
      </View>

      {projectId && data && (
        <>
          <View style={{ gap: space.sm }}>
            <T muted size={13} weight="600">STILL OPEN ({data.openTasks.length})</T>
            {data.openTasks.length === 0 ? (
              <T muted>Nothing open in this project.</T>
            ) : (
              data.openTasks.slice(0, 12).map((task) => (
                <T key={task.id}>
                  •  {task.text}
                  {task.owner ? <T muted> — {task.owner}</T> : null}
                  {task.due_text ? <T muted> (due {task.due_text})</T> : null}
                </T>
              ))
            )}
          </View>

          {data.last && (
            <Card style={{ gap: space.sm }}>
              <T weight="600">Last time: {data.last.title}</T>
              <T muted size={13}>{shortDate(data.last.created_at)}</T>
              {data.last.summary?.overview ? <T size={15}>{data.last.summary.overview}</T> : null}
              {decisions.length > 0 && (
                <View style={{ gap: 4 }}>
                  <T size={14} weight="600">Decided</T>
                  {decisions.slice(0, 6).map((d, i) => <T key={i} size={14}>•  {d.text}</T>)}
                </View>
              )}
              {questions.length > 0 && (
                <View style={{ gap: 4 }}>
                  <T size={14} weight="600">Left open</T>
                  {questions.slice(0, 6).map((q, i) => <T key={i} size={14}>•  {q}</T>)}
                </View>
              )}
              <Button label="Open notes" kind="ghost" onPress={() => router.push({ pathname: '/recording/[id]', params: { id: data.last!.id } })} />
            </Card>
          )}
        </>
      )}
      {!projectId && <T muted style={{ color: t.muted }}>Pick a project to see what&apos;s still open and what was decided last time.</T>}
    </ScrollView>
  );
}
