// The dimmed backdrop with a rounded cut-out for the spotlight target.
// Four rectangles around the target leave the target itself uncovered, so
// tapping it does what it normally does; the dimmed area swallows taps so a
// stray touch can't skip the tour or press something behind it.
import { useEffect, useMemo, useState } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";
import type { AnchorRect } from "./context";

const PAD = 8; // breathing room around the highlighted element
const RADIUS = 12;

export function Spotlight({
  rect,
  reduceMotion,
}: {
  rect: AnchorRect | null;
  reduceMotion: boolean;
}) {
  const [win, setWin] = useState(() => Dimensions.get("window"));
  const fade = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", () => setWin(Dimensions.get("window")));
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: reduceMotion ? 80 : 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade, rect, reduceMotion]);

  // A centred step (no target) dims the whole screen.
  const full = rect == null;
  const x = rect ? Math.max(0, rect.x - PAD) : 0;
  const y = rect ? Math.max(0, rect.y - PAD) : 0;
  const w = rect ? Math.min(win.width - x, rect.width + PAD * 2) : 0;
  const h = rect ? rect.height + PAD * 2 : 0;

  const rects = full
    ? [{ x: 0, y: 0, width: win.width, height: win.height }]
    : [
        { x: 0, y: 0, width: win.width, height: y }, // above
        { x: 0, y: y + h, width: win.width, height: Math.max(0, win.height - y - h) }, // below
        { x: 0, y, width: x, height: h }, // left
        { x: x + w, y, width: Math.max(0, win.width - x - w), height: h }, // right
      ];

  return (
    <Animated.View
      pointerEvents={full ? "auto" : "box-only"}
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
      accessibilityViewIsModal={false}
      importantForAccessibility="no-hide-descendants"
    >
      {rects.map((r, i) => (
        <View
          key={i}
          pointerEvents="auto"
          style={{
            position: "absolute",
            left: r.x,
            top: r.y,
            width: r.width,
            height: r.height,
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
        />
      ))}
      {rect && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: w,
            height: h,
            borderRadius: RADIUS,
            borderWidth: 2,
            borderColor: "#FFFFFF",
          }}
        />
      )}
    </Animated.View>
  );
}
