import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { TaskRow } from "@/components/TaskRow";
import { TourAnchor } from "@/components/tour/TourAnchor";
import { useTourController } from "@/components/tour/TourProvider";
import { Empty, Segmented } from "@/components/ui";
import { listTasks, updateTask } from "@/lib/api";
import { notify } from "@/lib/dialog";
import { TIPS } from "@/lib/onboarding";
import { markFirstTaskAction } from "@/lib/onboardingStore";
import { space, useTheme } from "@/lib/theme";
import type { Task } from "@/lib/types";

type Filter = "open" | "review" | "done";
type Row = Task & { recordings: { title: string } | null };

export default function Tasks() {
  const t = useTheme();
  const [filter, setFilter] = useState<Filter>("open");
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const { showTip, state, userId } = useTourController();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listTasks(filter));
    } catch (e) {
      notify("Couldn't load tasks", (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // One-time tip: the first time the To review segment actually has items.
  useEffect(() => {
    if (filter !== "review" || items.length === 0 || !userId) return;
    const tip = TIPS.find((x) => x.id === "tasks_review");
    if (!tip || state.tipsSeen.includes(tip.id)) return;
    showTip(tip);
  }, [filter, items.length, userId, state.tipsSeen, showTip]);

  async function patch(task: Row, change: Partial<Task>) {
    // Optimistic: the row leaves the current filter right away.
    setItems((rows) => rows.filter((r) => r.id !== task.id));
    // Keeping, dismissing or completing a task counts as checklist activity.
    if (userId) void markFirstTaskAction(userId);
    try {
      await updateTask(task.id, change);
    } catch (e) {
      notify("Couldn't update task", (e as Error).message);
      void load();
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, paddingBottom: space.sm }}>
        <TourAnchor id="segment-review">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { key: "open", label: "Open" },
            { key: "review", label: "To review" },
            { key: "done", label: "Done" },
          ]}
        />
        </TourAnchor>
      </View>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: space.xxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={t.muted}
          />
        }
        ListEmptyComponent={
          loading ? undefined : (
            <Empty
              title={
                filter === "review"
                  ? "Nothing to review"
                  : filter === "done"
                    ? "Nothing done yet"
                    : "No open tasks"
              }
              body={
                filter === "review"
                  ? "Tasks the AI was unsure about land here for a quick check."
                  : "Action items from your recordings show up here."
              }
            />
          )
        }
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            source={item.recordings?.title}
            onToggle={() =>
              patch(item, { status: item.status === "done" ? "open" : "done" })
            }
            onAccept={() =>
              patch(item, { needs_review: false, kind: "commitment" })
            }
            onDismiss={() => patch(item, { status: "dismissed" })}
            onQuotePress={
              item.recording_id
                ? () =>
                    router.push({
                      pathname: "/recording/[id]",
                      params: { id: item.recording_id! },
                    })
                : undefined
            }
          />
        )}
      />
    </View>
  );
}
