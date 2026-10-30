// The player that sits under a recording: play/pause, a scrubber, skip back and forward,
// speed and who is speaking. Every control has an accessible label.
import { useCallback, useRef, useState, type ComponentRef } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from "react-native";
import { T } from "@/components/ui";
import { clock } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";

const SPEED_TEXT: Record<number, string> = {
  0.75: "0.75×",
  1: "1×",
  1.25: "1.25×",
  1.5: "1.5×",
  2: "2×",
};

export function PlayerBar({
  playing,
  positionMs,
  durationMs,
  speed,
  speaker,
  following,
  onToggle,
  onSeek,
  onSkip,
  onSpeed,
  onToggleFollow,
}: {
  playing: boolean;
  positionMs: number;
  durationMs: number;
  speed: number;
  speaker: string | null;
  following?: boolean;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onSkip: (deltaMs: number) => void;
  onSpeed: () => void;
  onToggleFollow?: () => void;
}) {
  const t = useTheme();
  const track = useRef<ComponentRef<typeof View>>(null);
  const originX = useRef(0);
  const [width, setWidth] = useState(0);
  const total = Math.max(1, durationMs);
  const progress = Math.max(0, Math.min(1, positionMs / total));

  const measure = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    track.current?.measureInWindow((x) => {
      originX.current = x;
    });
  }, []);

  const seekFrom = useCallback(
    (pageX: number) => {
      if (!width) return;
      const fraction = Math.max(
        0,
        Math.min(1, (pageX - originX.current) / width),
      );
      onSeek(fraction * total);
    },
    [width, total, onSeek],
  );

  const responder = useCallback(
    (e: GestureResponderEvent) => seekFrom(e.nativeEvent.pageX),
    [seekFrom],
  );

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: t.surface, borderTopColor: t.border },
      ]}
    >
      <View style={styles.row}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : "Play"}
          style={styles.play}
          hitSlop={8}
        >
          <View style={[styles.playCircle, { backgroundColor: t.accent }]}>
            <T size={15} style={{ color: "#FFFFFF" }}>
              {playing ? "❚❚" : "▶"}
            </T>
          </View>
        </Pressable>
        <Pressable
          onPress={() => onSkip(-15000)}
          accessibilityRole="button"
          accessibilityLabel="Skip back 15 seconds"
          style={styles.small}
          hitSlop={8}
        >
          <T size={13}>⟲15</T>
        </Pressable>
        <Pressable
          onPress={() => onSkip(30000)}
          accessibilityRole="button"
          accessibilityLabel="Skip forward 30 seconds"
          style={styles.small}
          hitSlop={8}
        >
          <T size={13}>30⟳</T>
        </Pressable>
        <T muted size={13} style={styles.time}>
          {clock(positionMs)} / {clock(durationMs)}
        </T>
        <Pressable
          onPress={onSpeed}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${SPEED_TEXT[speed] ?? speed}`}
          style={[styles.speed, { borderColor: t.border }]}
          hitSlop={8}
        >
          <T size={13} weight="600">
            {SPEED_TEXT[speed] ?? `${speed}×`}
          </T>
        </Pressable>
      </View>

      <View
        ref={track}
        onLayout={measure}
        style={styles.track}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{
          min: 0,
          max: Math.round(total),
          now: Math.round(positionMs),
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "increment") onSkip(15000);
          if (e.nativeEvent.actionName === "decrement") onSkip(-15000);
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={responder}
        onResponderMove={responder}
      >
        <View style={[styles.trackBase, { backgroundColor: t.border }]}>
          <View
            style={[
              styles.trackFill,
              { backgroundColor: t.accent, width: `${progress * 100}%` },
            ]}
          />
        </View>
        <View
          style={[
            styles.knob,
            { backgroundColor: t.accent, left: `${progress * 100}%` },
          ]}
        />
      </View>

      <View style={styles.row}>
        <T muted size={12} style={{ flex: 1 }} numberOfLines={1}>
          {speaker ? `Now speaking: ${speaker}` : ""}
        </T>
        {onToggleFollow && (
          <Pressable
            onPress={onToggleFollow}
            accessibilityRole="button"
            accessibilityLabel={
              following
                ? "Stop following the transcript"
                : "Follow the transcript"
            }
            style={[styles.follow, { borderColor: t.border }]}
            hitSlop={8}
          >
            <T
              size={12}
              weight="600"
              style={{ color: following ? t.accent : t.muted }}
            >
              {following ? "Following" : "Follow"}
            </T>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  play: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  small: {
    minWidth: 44,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  time: { flex: 1 },
  speed: {
    paddingHorizontal: space.sm,
    minHeight: 30,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  follow: {
    paddingHorizontal: space.sm,
    minHeight: 28,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  track: { height: 28, justifyContent: "center" },
  trackBase: { height: 4, borderRadius: 2, overflow: "hidden" },
  trackFill: { height: 4 },
  knob: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
});
