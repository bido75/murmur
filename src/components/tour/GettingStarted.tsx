// The getting-started checklist card on the Recordings tab. It ticks itself
// off from real activity (no fake progress), collapses to one line after the
// first visit, and disappears for good once everything is done.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  checklist,
  checklistProgress,
  type ChecklistData,
} from "@/lib/onboarding";
import {
  loadState,
  setChecklistHidden,
} from "@/lib/onboardingStore";
import { useTourController } from "./TourProvider";
import { listProjects, listRecordings, localOnlyRecordings } from "@/lib/api";
import { radius, space, useTheme } from "@/lib/theme";
import { T } from "@/components/ui";

const COLLAPSE_KEY = "onboarding.checklist.collapsed.v1";

export function GettingStarted() {
  const t = useTheme();
  const router = useRouter();
  const { state, userId } = useTourController();
  const [data, setData] = useState<ChecklistData>({
    hasRecordings: false,
    hasReadyOpened: false,
    hasTaskAction: false,
    hasProject: false,
    hasSearch: false,
  });
  const [expanded, setExpanded] = useState(false);
    const tick = useMemo(() => new Animated.Value(0), []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const [recs, local, projects, s] = await Promise.all([
        listRecordings().catch(() => []),
        localOnlyRecordings().catch(() => []),
        listProjects().catch(() => []),
        loadState(userId),
      ]);
      const stored = s;
      setData({
        hasRecordings: recs.length > 0 || local.length > 0,
        // "Open your notes" is done once a ready recording was opened.
        hasReadyOpened: stored.firstReadyOpenedAt != null,
        hasTaskAction: stored.firstTaskActionAt != null,
        hasProject: projects.length > 0,
        hasSearch: stored.firstSearchAt != null,
      });
    } catch {
      // Offline or slow: the card simply shows what it knows.
    }
  }, [userId]);

  useEffect(() => {
    // Deferred so the first render stays pure (no sync setState in effect).
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // Collapsed to one line after the first visit.
  useEffect(() => {
    AsyncStorage.getItem(COLLAPSE_KEY)
      .then((v) => setExpanded(v !== "1"))
      .catch(() => setExpanded(true));
  }, []);

  useEffect(() => {
    if (!expanded) void AsyncStorage.setItem(COLLAPSE_KEY, "1").catch(() => undefined);
  }, [expanded]);

  const items = checklist(data);
  const { done, allDone } = checklistProgress(items);

  // Everything done: a "You&apos;re all set" card with a small check animation shows
  // once, then the card hides for good (hidden in the store, so web and phone
  // agree). The celebration state is derived, not stored, so no flag is needed.
  useEffect(() => {
    if (!allDone || state.checklistHidden) return;
    Animated.timing(tick, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      if (userId) void setChecklistHidden(userId, true);
    }, 2200);
    return () => clearTimeout(timer);
  }, [allDone, state.checklistHidden, tick, userId]);

  const celebrating = allDone && !state.checklistHidden;
  if (state.checklistHidden) return null;

  const go = (route: string) => {
    if (route === "/recordings/newest-ready") {
      // "Open your notes" opens the newest ready recording; the screen that
      // lands there marks the first-ready-opened activity.
      void listRecordings()
        .then((recs) => {
          const ready = recs.find((r) => r.status === "ready");
          if (ready) router.push(`/recording/${ready.id}` as never);
          else router.push("/" as never);
        })
        .catch(() => router.push("/" as never));
      return;
    }
    router.push(route as never);
  };

  if (celebrating) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: t.accentSoft, borderColor: t.accentSoft },
        ]}
        accessibilityRole="alert"
      >
        <Animated.Text
          style={{
            color: t.accent,
            fontSize: 22,
            opacity: tick,
            transform: [{ scale: tick.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        >
          ✓
        </Animated.Text>
        <T weight="700" style={{ color: t.accent }}>
          You&apos;re all set
        </T>
      </View>
    );
  }

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Get started, ${done} of 5 done. Tap to expand.`}
        onPress={() => setExpanded(true)}
        style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <T weight="700" size={14}>
            Get started · {done} of 5
          </T>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: t.border }}>
            <View
              style={{
                width: `${(done / 5) * 100}%`,
                height: 4,
                borderRadius: 2,
                backgroundColor: t.accent,
              }}
            />
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}>
        <T weight="700" size={14} style={{ flex: 1 }}>
          Get started · {done} of 5
        </T>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide checklist"
          onPress={() => {
            if (userId) void setChecklistHidden(userId, true);
          }}
          hitSlop={6}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
        >
          <Text style={{ color: t.muted, fontSize: 13 }}>Hide</Text>
        </Pressable>
      </View>

      <View style={{ height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: space.sm }}>
        <View
          style={{
            width: `${(done / 5) * 100}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: t.accent,
          }}
        />
      </View>

      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityState={{ checked: item.done }}
          accessibilityLabel={`${item.title}${item.done ? ", done" : ""}`}
          disabled={item.done}
          onPress={() => {
            // The activity itself (task kept/dismissed, search run, notes
            // opened) is what ticks these items — navigating is just a shortcut.
            go(item.route);
          }}
          style={{
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: item.done ? t.accent : t.border,
              backgroundColor: item.done ? t.accent : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {item.done && <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text>}
          </View>
          <T
            size={14}
            muted={item.done}
            style={item.done ? undefined : { flex: 1 }}
          >
            {item.title}
          </T>
          {!item.done && (
            <Text style={{ color: t.accent, fontSize: 13, marginLeft: "auto" }}>Open</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
});
