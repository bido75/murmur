import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { TaskRow } from "@/components/TaskRow";
import { Empty, Segmented } from "@/components/ui";
import { listTasks, updateTask } from "@/lib/api";
import { notify } from "@/lib/dialog";
import { space, useTheme } from "@/lib/theme";
import type { Task } from "@/lib/types";

type Filter = "open" | "review" | "done";
type Row = Task & { recordings: { title: string } | null };

export default function Tasks() {
  const t = useTheme();
  const [filter, setFilter] = useState<Filter>("open");
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

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

  async function patch(task: Row, change: Partial<Task>) {
    // Optimistic: the row leaves the current filter right away.
    setItems((rows) => rows.filter((r) => r.id !== task.id));
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
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { key: "open", label: "Open" },
            { key: "review", label: "To review" },
            { key: "done", label: "Done" },
          ]}
        />
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
